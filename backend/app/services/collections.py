"""Personal collections: create, curate, and read (``docs/api.md#collections``).

What a collection shows is one predicate, :func:`services.event_filters.collectable_events`.
An event joins only the collections of an analyst credited on it, and no SQL constraint spans
the tables, so :func:`ensure_collectable` enforces it.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time
from typing import Any, NamedTuple

from sqlalchemy import ColumnElement, func, select, union
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from app.errors import CodedError
from app.models.collection import Collection, CollectionEvent
from app.models.content_report import ContentReport
from app.models.event import Event
from app.models.media import Media
from app.models.source import Source, source_tags
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.schemas.collection import (
    DESCRIPTION_MAX_LENGTH,
    CollectionCoverTile,
    CollectionMembershipRead,
    CollectionRead,
)
from app.schemas.tag import TagRead
from app.services.event_filters import collectable_events, credited_to
from app.services.events.errors import EventNotFoundError
from app.services.geolocator_credit import CREDIT_LOAD
from app.services.pagination import keyset_after
from app.services.permissions import ensure_owner
from app.services.row_locks import lock_row
from app.services.sanitize import html_text, sanitize_html
from app.services.thumbnails import has_thumbnail, thumbnail_candidates, thumbnail_loads


class CollectionNotFoundError(CodedError):
    code = "collection_not_found"
    status_code = 404


class EventNotCollectableError(CodedError):
    code = "event_not_collectable"
    status_code = 409


class NotCreditedError(CodedError):
    code = "not_credited"
    status_code = 403


class InvalidDescriptionError(CodedError):
    code = "invalid_description"
    status_code = 400


class TooManyEventsError(CodedError):
    code = "too_many_events"
    status_code = 422


# Stand-ins for a missing date and hour: they make the order NULLS LAST and
# keep the keyset a single row comparison (comparing against NULL is unknown
# and would drop the page cut). A real 9999-12-31 event ties with an undated
# one; the ``created_at, id`` tail breaks the tie.
NO_DATE = date(9999, 12, 31)
NO_TIME = time(23, 59, 59, 999999)

# Rows the add-to-collection popover lists, unpaged. Past the cap the older
# collections are absent from it silently.
MAX_POPOVER_COLLECTIONS = 100


# Mirrored by frontend EventPicker.tsx (its date and id keys only); change both.
def chronological_key() -> tuple[Any, ...]:
    """The ascending sort key of a collection's items. The ``ORDER BY``, the keyset predicate and
    the cursor (:func:`cursor_values`) must agree on it."""
    return (
        func.coalesce(Event.occurred_date, NO_DATE),
        func.coalesce(Event.occurred_time, NO_TIME),
        Event.created_at,
        Event.id,
    )


def cursor_values(event: Event) -> tuple[date, time, datetime, uuid.UUID]:
    return (
        event.occurred_date or NO_DATE,
        event.occurred_time or NO_TIME,
        event.created_at,
        event.id,
    )


class CollectionStats(NamedTuple):
    event_count: int
    first_date: date | None
    last_date: date | None


_EMPTY_STATS = CollectionStats(event_count=0, first_date=None, last_date=None)


def visible_collections() -> tuple[ColumnElement[bool], ...]:
    """Not withheld, not deleted by its owner pending a report, and owned by a live account."""
    return (
        Collection.hidden_at.is_(None),
        Collection.deleted_at.is_(None),
        Collection.owner.has(User.deleted_at.is_(None)),
    )


def has_showable_item(*criteria: ColumnElement[bool]) -> ColumnElement[bool]:
    """Correlated EXISTS: this collection holds at least one showable event, matching
    ``criteria`` when given."""
    return (
        select(1)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .where(CollectionEvent.collection_id == Collection.id, collectable_events(), *criteria)
        .correlate(Collection)
        .exists()
    )


def stats_for(db: Session, collection_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, CollectionStats]:
    """A collection with nothing showable is absent; default to :data:`_EMPTY_STATS`."""
    if not collection_ids:
        return {}
    rows = (
        db.query(
            CollectionEvent.collection_id,
            func.count(Event.id),
            func.min(Event.occurred_date),
            func.max(Event.occurred_date),
        )
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .filter(CollectionEvent.collection_id.in_(collection_ids), collectable_events())
        .group_by(CollectionEvent.collection_id)
        .all()
    )
    return {
        collection_id: CollectionStats(
            event_count=count, first_date=first_date, last_date=last_date
        )
        for collection_id, count, first_date, last_date in rows
    }


# Tiles in the profile card's mosaic; a fifth would be too small to read.
# Mirrored by frontend lib/og.ts MOSAIC_MAX_TILES; change both.
COVER_TILES = 4


def _tile_media(event: Event) -> Media | None:
    """:func:`services.thumbnails.pick_thumbnail`, except a tile prefers an image over a source
    clip, since a tile never plays. Every other card surface names the item's own footage."""
    candidates = thumbnail_candidates(event)
    if not candidates:
        return None
    return next((row for row in candidates if row.kind == "image"), candidates[0])


def cover_tiles_for(
    db: Session, collection_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[CollectionCoverTile]]:
    """The mosaic of each collection: up to :data:`COVER_TILES` collectable items in
    chronological order, one tile each from :func:`_tile_media`. A graphic item is skipped, so
    no reader meets it on a card they did not open.

    A tile carries ``role`` because proof images have no display derivative
    (``services/storage.upload_proof_image``), so a client reads the original.
    """
    if not collection_ids:
        return {}
    ranked = (
        select(
            CollectionEvent.collection_id.label("collection_id"),
            CollectionEvent.event_id.label("event_id"),
            func.row_number()
            .over(
                partition_by=CollectionEvent.collection_id,
                order_by=chronological_key(),
            )
            .label("rank"),
        )
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .where(
            CollectionEvent.collection_id.in_(collection_ids),
            collectable_events(),
            ~Event.is_graphic,
            has_thumbnail(),
        )
        .subquery()
    )
    rows = (
        db.query(ranked.c.collection_id, Event)
        .select_from(ranked)
        .join(Event, Event.id == ranked.c.event_id)
        .options(*thumbnail_loads())
        .filter(ranked.c.rank <= COVER_TILES)
        .order_by(ranked.c.collection_id, ranked.c.rank)
        .all()
    )
    tiles: dict[uuid.UUID, list[CollectionCoverTile]] = {}
    for collection_id, event in rows:
        media = _tile_media(event)
        if media is None:
            continue
        tiles.setdefault(collection_id, []).append(
            CollectionCoverTile(
                url=media.storage_url,
                kind=media.kind,
                role=media.role,
            )
        )
    return tiles


def tags_for(db: Session, collection_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[TagRead]]:
    """The union of the tags of each collection's collectable items and their sources, by name.
    A collection with nothing tagged is absent."""
    if not collection_ids:
        return {}
    item_tags = union(
        select(event_tags.c.event_id, event_tags.c.tag_id),
        select(Source.event_id, source_tags.c.tag_id).join(
            source_tags, source_tags.c.source_id == Source.id
        ),
    ).subquery()
    rows = (
        db.query(CollectionEvent.collection_id, Tag)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .join(item_tags, item_tags.c.event_id == Event.id)
        .join(Tag, Tag.id == item_tags.c.tag_id)
        .filter(CollectionEvent.collection_id.in_(collection_ids), collectable_events())
        .distinct()
        .order_by(CollectionEvent.collection_id, Tag.name)
        .all()
    )
    tags: dict[uuid.UUID, list[TagRead]] = {}
    for collection_id, tag in rows:
        tags.setdefault(collection_id, []).append(TagRead.model_validate(tag, from_attributes=True))
    return tags


def build_collection_reads(db: Session, collections: Sequence[Collection]) -> list[CollectionRead]:
    collection_ids = [collection.id for collection in collections]
    stats = stats_for(db, collection_ids)
    tiles = cover_tiles_for(db, collection_ids)
    tags = tags_for(db, collection_ids)
    reads: list[CollectionRead] = []
    for collection in collections:
        row_stats = stats.get(collection.id, _EMPTY_STATS)
        reads.append(
            CollectionRead(
                id=collection.id,
                owner=collection.owner,
                title=collection.title,
                description=collection.description,
                description_text=collection.description_text,
                cover=tiles.get(collection.id, []),
                tags=tags.get(collection.id, []),
                event_count=row_stats.event_count,
                first_date=row_stats.first_date,
                last_date=row_stats.last_date,
                created_at=collection.created_at,
                hidden_at=collection.hidden_at,
            )
        )
    return reads


def build_collection_read(db: Session, collection: Collection) -> CollectionRead:
    return build_collection_reads(db, [collection])[0]


def resolve_collection(db: Session, *, collection_id: uuid.UUID, viewer: User | None) -> Collection:
    """A collection :func:`visible_collections` names, or any collection for an admin."""
    query = db.query(Collection).options(joinedload(Collection.owner))
    query = query.filter(Collection.id == collection_id)
    if viewer is None or not viewer.is_admin:
        query = query.filter(*visible_collections())
    collection = query.first()
    if collection is None:
        raise CollectionNotFoundError("Collection not found")
    return collection


def ensure_owned_live(collection: Collection, user: User) -> None:
    """403 unless ``user`` owns ``collection``, then 404 once its owner deleted it: an admin reads
    a deleted collection to judge its report, but nobody writes to it."""
    ensure_owner(collection, user)
    if collection.deleted_at is not None:
        raise CollectionNotFoundError("Collection not found")


def _refuse_uncredited(credited: bool) -> None:
    if not credited:
        raise NotCreditedError("Not authorized")


def ensure_credited(db: Session, *, event_id: uuid.UUID, user: User) -> None:
    credited = db.query(credited_to([user.id])).filter(Event.id == event_id).scalar()
    _refuse_uncredited(bool(credited))


def ensure_collectable(db: Session, *, event_ids: Sequence[uuid.UUID], user: User) -> None:
    """Per id, in arrival order: an unknown event is a 404, an uncredited one a 403, and a state a
    collection does not show a 409."""
    rows = _eligibility(db, event_ids=event_ids, user=user)
    for event_id in event_ids:
        row = _known(rows, event_id)
        if not row.collectable:
            raise EventNotCollectableError("This event is not one a collection can hold")


def split_collectable(
    db: Session, *, event_ids: Sequence[uuid.UUID], user: User
) -> tuple[list[uuid.UUID], int]:
    """The ids a collection of ``user``'s can hold, in arrival order, and how many it cannot:
    :func:`ensure_collectable` with a state a collection does not show counted, not refused."""
    rows = _eligibility(db, event_ids=event_ids, user=user)
    collectable = [event_id for event_id in event_ids if _known(rows, event_id).collectable]
    return collectable, len(event_ids) - len(collectable)


def _eligibility(
    db: Session, *, event_ids: Sequence[uuid.UUID], user: User
) -> dict[uuid.UUID, Any]:
    if not event_ids:
        return {}
    return {
        row.id: row
        for row in db.query(
            Event.id,
            credited_to([user.id]).label("credited"),
            collectable_events().label("collectable"),
        ).filter(Event.id.in_(event_ids))
    }


def _known(rows: dict[uuid.UUID, Any], event_id: uuid.UUID) -> Any:
    row = rows.get(event_id)
    if row is None:
        raise EventNotFoundError("Event not found")
    _refuse_uncredited(row.credited)
    return row


class _CheckedDescription(NamedTuple):
    html: str
    text: str


def _checked_description(description: str) -> _CheckedDescription:
    """Sanitise a description and judge it on its text projection, so bolding a word costs no
    characters and blank paragraphs are a missing description."""
    try:
        html = sanitize_html(description, allow_images=False)
    except ValueError as exc:
        raise InvalidDescriptionError(str(exc)) from exc
    text = html_text(html)
    if not text:
        raise InvalidDescriptionError("A description must not be empty")
    if len(text) > DESCRIPTION_MAX_LENGTH:
        raise InvalidDescriptionError(
            f"A description must be at most {DESCRIPTION_MAX_LENGTH} characters"
        )
    return _CheckedDescription(html=html, text=text)


def create_collection(
    db: Session,
    *,
    owner: User,
    title: str,
    description: str,
    event_ids: Sequence[uuid.UUID] = (),
) -> Collection:
    """``event_ids`` join in the same transaction, so one refusal takes the whole create with it.
    The caller de-duplicates and caps them (``schemas/collection.CollectionCreate``)."""
    checked = _checked_description(description)
    collection = Collection(
        owner_id=owner.id,
        title=title,
        description=checked.html,
        description_text=checked.text,
    )
    db.add(collection)
    try:
        db.flush()
        ensure_collectable(db, event_ids=event_ids, user=owner)
        db.add_all(
            CollectionEvent(collection_id=collection.id, event_id=event_id)
            for event_id in event_ids
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(collection)
    return collection


def update_collection_details(
    db: Session, *, collection: Collection, user: User, title: str, description: str
) -> Collection:
    """Ownership is settled first: a stranger gets a 403 whatever the body."""
    ensure_owned_live(collection, user)
    checked = _checked_description(description)
    collection.title = title
    collection.description = checked.html
    collection.description_text = checked.text
    db.commit()
    db.refresh(collection)
    return collection


def _has_open_report(db: Session, collection_id: uuid.UUID) -> bool:
    return bool(
        db.query(
            select(ContentReport.id)
            .where(
                ContentReport.collection_id == collection_id,
                ContentReport.resolved_at.is_(None),
            )
            .exists()
        ).scalar()
    )


def delete_collection(db: Session, *, collection: Collection, user: User) -> None:
    """Erase ``collection``, or only stamp ``deleted_at`` while an open content report names it,
    so the moderators keep the evidence until :func:`erase_if_released`."""
    ensure_owned_live(collection, user)
    # Locked like ``services/reports.resolve_report`` locks it, and both decide on the open
    # reports after the lock, so whichever runs second sees the other's write: a delete racing
    # the last verdict either erases at once or is erased by the verdict.
    locked = lock_row(db, Collection, Collection.id == collection.id).first()
    if locked is None:
        return
    if _has_open_report(db, collection.id):
        if collection.deleted_at is None:
            collection.deleted_at = datetime.now(UTC)
    else:
        db.delete(collection)
    db.commit()


def erase_if_released(db: Session, *, collection: Collection) -> bool:
    """Erase a collection its owner deleted once no open report names it, and return whether it
    did. The caller holds the row lock and commits."""
    if collection.deleted_at is None or _has_open_report(db, collection.id):
        return False
    db.delete(collection)
    return True


def add_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> None:
    """Idempotent. A foreign-key violation means the collection or event vanished, and answering
    204 would claim a shelving that did not happen, so it raises (500).
    """
    ensure_owned_live(collection, user)
    ensure_collectable(db, event_ids=[event_id], user=user)
    insert_memberships(db, collection_id=collection.id, event_ids=[event_id])
    db.commit()


def insert_memberships(
    db: Session, *, collection_id: uuid.UUID, event_ids: Sequence[uuid.UUID]
) -> int:
    """Stage the memberships of ``event_ids`` the collection lacks and return how many it wrote.

    ``ON CONFLICT DO NOTHING`` on the membership key is the idempotency: a row already present,
    or one a concurrent add writes first, is skipped. Any other violation, such as a foreign key
    to a vanished row, raises.
    """
    if not event_ids:
        return 0
    now = datetime.now(UTC)
    inserted = db.execute(
        insert(CollectionEvent)
        .values(
            [
                {"collection_id": collection_id, "event_id": event_id, "added_at": now}
                for event_id in event_ids
            ]
        )
        .on_conflict_do_nothing(index_elements=["collection_id", "event_id"])
        .returning(CollectionEvent.event_id)
    ).all()
    return len(inserted)


def remove_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> None:
    """Idempotent. Eligibility is not re-checked, so an owner can always clear a membership whose
    event has since closed or been withheld."""
    ensure_owned_live(collection, user)
    row = (
        db.query(CollectionEvent)
        .filter(
            CollectionEvent.collection_id == collection.id,
            CollectionEvent.event_id == event_id,
        )
        .first()
    )
    if row is None:
        return
    db.delete(row)
    db.commit()


def list_items(
    db: Session,
    *,
    collection_id: uuid.UUID,
    limit: int,
    cursor: tuple[date, time, datetime, uuid.UUID] | None = None,
) -> list[Event]:
    """One window of the collection's events in :func:`chronological_key` order, over-fetched
    by one row for ``pagination.paged``."""
    key = chronological_key()
    query = (
        db.query(Event)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            *thumbnail_loads(),
            CREDIT_LOAD,
        )
        .filter(CollectionEvent.collection_id == collection_id, collectable_events())
    )
    if cursor is not None:
        query = query.filter(keyset_after(key, cursor))
    return query.order_by(*key).limit(limit + 1).all()


def list_owned_collections(
    db: Session,
    *,
    owner_id: uuid.UUID,
    include_empty: bool,
    page: int,
    per_page: int,
) -> tuple[list[Collection], int]:
    """``include_empty`` is the owner's view. A withheld collection is hidden from its owner as
    well."""
    query = db.query(Collection).options(joinedload(Collection.owner))
    query = query.filter(Collection.owner_id == owner_id, *visible_collections())
    if not include_empty:
        query = query.filter(has_showable_item())
    total = query.count()
    rows = (
        query.order_by(Collection.created_at.desc(), Collection.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return list(rows), total


def list_memberships(
    db: Session, *, owner: User, event_id: uuid.UUID
) -> list[CollectionMembershipRead]:
    collections = (
        db.query(Collection)
        .filter(Collection.owner_id == owner.id, *visible_collections())
        .order_by(Collection.created_at.desc(), Collection.id.desc())
        .limit(MAX_POPOVER_COLLECTIONS)
        .all()
    )
    collection_ids = [collection.id for collection in collections]
    member_ids: set[uuid.UUID] = set()
    if collections:
        member_ids = {
            collection_id
            for (collection_id,) in db.query(CollectionEvent.collection_id)
            .filter(
                CollectionEvent.event_id == event_id,
                CollectionEvent.collection_id.in_(collection_ids),
            )
            .all()
        }
    stats = stats_for(db, collection_ids)
    tiles = cover_tiles_for(db, collection_ids)
    return [
        CollectionMembershipRead(
            id=collection.id,
            title=collection.title,
            cover=tiles.get(collection.id, []),
            event_count=stats.get(collection.id, _EMPTY_STATS).event_count,
            in_collection=collection.id in member_ids,
        )
        for collection in collections
    ]
