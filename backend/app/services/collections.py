"""Personal collections: create, curate, and read.

A collection is a named set of one analyst's own events, shown on the owner's
public profile. Two rules hold everywhere in this module:

* **What a collection may show is one predicate**,
  :func:`services.event_filters.collectable_events`. The item page, count,
  date range, mosaic, tag union and add verb all read it, so an event that
  closes, is taken down or is soft-deleted leaves all of them with no write to
  ``collection_events``.
* **An event joins its owner's collection only.** No SQL constraint spans the
  two tables, so :func:`ensure_collectable` enforces it with
  :func:`services.permissions.ensure_owner` (403 for someone else's event), for
  both :func:`add_event` and :func:`create_collection`.

A collection stores no file: its card mosaic is read off the items at request
time by :func:`cover_tiles_for`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime, time
from typing import Any, NamedTuple

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.collection import Collection, CollectionEvent
from app.models.event import Event
from app.models.media import Media
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.schemas.collection import (
    DESCRIPTION_MAX_LENGTH,
    CollectionCoverTile,
    CollectionMembershipRead,
    CollectionRead,
)
from app.schemas.tag import TagRead
from app.services.event_filters import collectable_events
from app.services.pagination import keyset_after
from app.services.permissions import ensure_owner
from app.services.sanitize import sanitize_tiptap_doc_or_raise, tiptap_doc_text
from app.services.thumbnails import pick_thumbnail, thumbnail_media_criteria


class CollectionError(Exception):
    """A collection write or read the rules refuse.

    Stable ``code`` per subclass, the same contract as
    :class:`app.services.evidence_intake.EvidenceIntakeError`.
    """

    code: str


class CollectionNotFoundError(CollectionError):
    """No collection with that id is readable by this caller."""

    code = "collection_not_found"


class EventNotFoundError(CollectionError):
    """No event with that id exists at all."""

    code = "event_not_found"


class EventNotCollectableError(CollectionError):
    """The event exists but a collection may not hold it."""

    code = "event_not_collectable"


class InvalidDescriptionError(CollectionError):
    """The description breaks one of the rules in :func:`_checked_description`.

    Maps to 400, like :class:`services.events.InvalidProofError`.
    """

    code = "invalid_description"


COLLECTION_ERROR_STATUS: dict[str, int] = {
    "collection_not_found": 404,
    "event_not_found": 404,
    "event_not_collectable": 409,
    "invalid_description": 400,
}


# Stand-ins for a missing date and hour: they make the order NULLS LAST and
# keep the keyset a single row comparison (comparing against NULL is unknown
# and would drop the page cut). A real 9999-12-31 event ties with an undated
# one; the ``created_at, id`` tail breaks the tie.
NO_DATE = date(9999, 12, 31)
NO_TIME = time(23, 59, 59, 999999)

# Rows the add-to-collection popover lists, unpaged. Past the cap the older
# collections are absent from it silently.
MAX_POPOVER_COLLECTIONS = 100

# SQLSTATE 23505 (unique violation), read as ``exc.orig.pgcode``.
_UNIQUE_VIOLATION = "23505"


def chronological_key() -> tuple[Any, ...]:
    """The sort key a collection's items read by, as SQL expressions.

    ``event_date``, ``event_time`` (through their stand-ins), ``created_at``,
    ``id``, ascending. The ``ORDER BY``, the keyset predicate
    (:func:`services.pagination.keyset_after`) and the cursor must agree on it.
    """
    return (
        func.coalesce(Event.event_date, NO_DATE),
        func.coalesce(Event.event_time, NO_TIME),
        Event.created_at,
        Event.id,
    )


def cursor_values(event: Event) -> tuple[date, time, datetime, uuid.UUID]:
    """The sort values of one item, for its cursor (Python side of :func:`chronological_key`)."""
    return (
        event.event_date or NO_DATE,
        event.event_time or NO_TIME,
        event.created_at,
        event.id,
    )


class CollectionStats(NamedTuple):
    """What a collection's items add up to at read time.

    ``first_date`` / ``last_date`` are the min and max ``event_date``, ``None``
    when no item has one.
    """

    event_count: int
    first_date: date | None
    last_date: date | None


_EMPTY_STATS = CollectionStats(event_count=0, first_date=None, last_date=None)


def visible_collections() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """The predicate pair naming a collection a reader may see.

    Not withheld (``hidden_at``) and owned by a non-deleted account. Every
    reader surface spreads it (``*visible_collections()``), like
    :func:`services.event_filters.visible_events`. Admins skip it to judge a
    takedown (:func:`resolve_collection`, ``services/admin.hide_collection``).
    """
    return Collection.hidden_at.is_(None), Collection.owner.has(User.deleted_at.is_(None))


def has_showable_item() -> ColumnElement[bool]:
    """Correlated EXISTS: this collection holds at least one showable event.

    Applied to rows and ``total`` alike so a pager never counts a dropped
    collection. ``services/search.search_collections`` reads it too.
    """
    return (
        select(1)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .where(CollectionEvent.collection_id == Collection.id, collectable_events())
        .correlate(Collection)
        .exists()
    )


def stats_for(db: Session, collection_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, CollectionStats]:
    """Count and date range per collection, in one grouped query.

    A collection with nothing showable is absent; default to :data:`_EMPTY_STATS`.
    """
    if not collection_ids:
        return {}
    rows = (
        db.query(
            CollectionEvent.collection_id,
            func.count(Event.id),
            func.min(Event.event_date),
            func.max(Event.event_date),
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
COVER_TILES = 4


def _has_thumbnail_media() -> ColumnElement[bool]:
    """Correlated EXISTS: this event carries media a card may show.

    Keeps text-only items out of the ranking so the mosaic still fills from
    later ones (:func:`services.thumbnails.thumbnail_media_criteria`).
    """
    return (
        select(1)
        .select_from(Media)
        .where(Media.event_id == Event.id, thumbnail_media_criteria())
        .correlate(Event)
        .exists()
    )


def _tile_media(rows: Sequence[Media]) -> Media | None:
    """The media one item contributes to a mosaic, images preferred.

    :func:`services.thumbnails.pick_thumbnail`, except a tile prefers an image
    over a source clip (a tile never plays). Kept here because every other card
    surface must go on naming the item's own footage.
    """
    picked = pick_thumbnail(rows)
    if picked is None or picked.media_type == "image":
        return picked
    return next((row for row in rows if row.media_type == "image"), picked)


def cover_tiles_for(
    db: Session, collection_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[CollectionCoverTile]]:
    """The mosaic each collection wears, up to :data:`COVER_TILES` tiles.

    Walks the collectable items (:func:`services.event_filters.collectable_events`)
    in chronological order, skips ``is_graphic`` ones (so no reader meets
    death or injury on a card they did not open, and the walk continues), and
    takes one tile per item from :func:`_tile_media`. Nothing showable gives an
    empty list (the card placeholder).

    A tile carries ``role`` because proof images have no display derivative
    (``services/storage.upload_proof_image``), so a client reads the original.

    Two statements per page: a window-function ranking that keeps the first
    four per collection, then the eager media load.
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
            Event.is_graphic.is_(False),
            _has_thumbnail_media(),
        )
        .subquery()
    )
    rows = (
        db.query(ranked.c.collection_id, Event)
        .select_from(ranked)
        .join(Event, Event.id == ranked.c.event_id)
        .options(selectinload(Event.media.and_(thumbnail_media_criteria())))
        .filter(ranked.c.rank <= COVER_TILES)
        .order_by(ranked.c.collection_id, ranked.c.rank)
        .all()
    )
    tiles: dict[uuid.UUID, list[CollectionCoverTile]] = {}
    for collection_id, event in rows:
        media = _tile_media(event.media)
        if media is None:
            continue
        tiles.setdefault(collection_id, []).append(
            CollectionCoverTile(
                url=media.storage_url,
                media_type=media.media_type,
                role=media.role,
            )
        )
    return tiles


def tags_for(db: Session, collection_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[TagRead]]:
    """The tags each collection inherits from its items, in one query.

    A collection carries no tag of its own: it is the union of the tags of its
    collectable events (:func:`services.event_filters.collectable_events`),
    computed on read and never stored.

    ``DISTINCT`` over (collection, tag) makes it a union, ordered by category
    then name so cards and the header print the same list. A collection with
    nothing tagged is absent from the mapping.
    """
    if not collection_ids:
        return {}
    rows = (
        db.query(CollectionEvent.collection_id, Tag)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .join(event_tags, event_tags.c.event_id == Event.id)
        .join(Tag, Tag.id == event_tags.c.tag_id)
        .filter(CollectionEvent.collection_id.in_(collection_ids), collectable_events())
        .distinct()
        .order_by(CollectionEvent.collection_id, Tag.category, Tag.name)
        .all()
    )
    tags: dict[uuid.UUID, list[TagRead]] = {}
    for collection_id, tag in rows:
        tags.setdefault(collection_id, []).append(TagRead.model_validate(tag, from_attributes=True))
    return tags


def build_collection_reads(db: Session, collections: Sequence[Collection]) -> list[CollectionRead]:
    """Assemble the read payload for a page of collections.

    The single assembler, so the shape is the same everywhere. Stats, mosaics
    and tags are each one batched query for the whole page.
    """
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
            )
        )
    return reads


def build_collection_read(db: Session, collection: Collection) -> CollectionRead:
    """The read payload for one collection, through the page assembler."""
    return build_collection_reads(db, [collection])[0]


def resolve_collection(db: Session, *, collection_id: uuid.UUID, viewer: User | None) -> Collection:
    """Fetch a readable collection by id, or raise :class:`CollectionNotFoundError`.

    Readable is :func:`visible_collections`: a withheld collection or one
    owned by a soft-deleted user reads as not found, except to an admin (the
    branch ``GET /events/{id}`` takes).
    """
    query = db.query(Collection).options(joinedload(Collection.owner))
    query = query.filter(Collection.id == collection_id)
    if viewer is None or not viewer.is_admin:
        query = query.filter(*visible_collections())
    collection = query.first()
    if collection is None:
        raise CollectionNotFoundError("Collection not found")
    return collection


def ensure_collectable(db: Session, *, event_ids: Sequence[uuid.UUID], user: User) -> None:
    """Refuse any id that is not one of ``user``'s collectable events.

    Per id, in arrival order: no such event is a 404, somebody else's event is
    a 403, and a state a collection does not show
    (:func:`services.event_filters.collectable_events`) is a 409. Shared by
    :func:`add_event` and :func:`create_collection`. One statement whatever the
    count, projecting only the columns the refusals read.
    """
    if not event_ids:
        return
    rows = {
        row.id: row
        for row in db.query(
            Event.id,
            Event.owner_id,
            collectable_events().label("collectable"),
        ).filter(Event.id.in_(event_ids))
    }
    for event_id in event_ids:
        row = rows.get(event_id)
        if row is None:
            raise EventNotFoundError("Event not found")
        ensure_owner(row, user)
        if not row.collectable:
            raise EventNotCollectableError("This event is not one a collection can hold")


class _CheckedDescription(NamedTuple):
    """A description that passed the rules: the document and its text projection.

    Written together (``description`` and ``description_text``) so they cannot
    disagree.
    """

    doc: dict[str, Any]
    text: str


def _checked_description(description: dict[str, Any]) -> _CheckedDescription:
    """Sanitise a description and judge it on the text it carries.

    Shared by create and update. Three refusals, all
    :class:`InvalidDescriptionError`:

    * Not a Tiptap document the sanitiser accepts with ``allow_images=False``
      (no upload path behind a description).
    * Empty projection (:func:`services.sanitize.tiptap_doc_text`): blank
      paragraphs are a missing description.
    * Projection over :data:`schemas.collection.DESCRIPTION_MAX_LENGTH`,
      measured on text so bolding a word costs no characters.
    """
    doc = sanitize_tiptap_doc_or_raise(
        description, error=InvalidDescriptionError, allow_images=False
    )
    text = tiptap_doc_text(doc)
    if not text:
        raise InvalidDescriptionError("A description must not be empty")
    if len(text) > DESCRIPTION_MAX_LENGTH:
        raise InvalidDescriptionError(
            f"A description must be at most {DESCRIPTION_MAX_LENGTH} characters"
        )
    return _CheckedDescription(doc=doc, text=text)


def create_collection(
    db: Session,
    *,
    owner: User,
    title: str,
    description: dict[str, Any],
    event_ids: Sequence[uuid.UUID] = (),
) -> Collection:
    """Open a collection for ``owner``, named, described, and holding ``event_ids``.

    ``description`` is the raw Tiptap document, checked by
    :func:`_checked_description` and stored with its projection (as in
    :func:`update_collection_details`), which keeps search and text-only
    surfaces in step with the stored document.

    ``event_ids`` join in the same transaction through
    :func:`ensure_collectable`, so one refusal takes the whole create with it.
    The caller de-duplicates and caps them (``schemas/collection.CollectionCreate``).
    """
    checked = _checked_description(description)
    collection = Collection(
        owner_id=owner.id,
        title=title,
        description=checked.doc,
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
    db: Session, *, collection: Collection, user: User, title: str, description: dict[str, Any]
) -> Collection:
    """Write ``collection``'s title and description. 403 for anyone but the owner.

    One verb for both fields so a rename never describes the old collection.
    ``description`` takes the same checks and pairing as
    :func:`create_collection`. Ownership is settled first: a stranger gets a
    403 whatever the document.
    """
    ensure_owner(collection, user)
    checked = _checked_description(description)
    collection.title = title
    collection.description = checked.doc
    collection.description_text = checked.text
    db.commit()
    db.refresh(collection)
    return collection


def delete_collection(db: Session, *, collection: Collection, user: User) -> None:
    """Drop ``collection``, leaving every event it held untouched.

    403 for anyone but the owner. Membership rows go through the cascade; a
    collection is only a view over the events.
    """
    ensure_owner(collection, user)
    db.delete(collection)
    db.commit()


def add_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> None:
    """Put one event on ``collection``. Idempotent: adding it twice writes one row.

    The collection must be the caller's (403), then :func:`ensure_collectable`
    applies: unknown event 404, foreign event 403, non-collectable state 409.

    The composite primary key is the idempotency: the INSERT runs in a
    SAVEPOINT, so an existing or racing row rolls back only its own statement.
    Like ``services/social.follow_user`` without the pre-SELECT.

    Only :data:`_UNIQUE_VIOLATION` is swallowed. A foreign-key violation means
    the collection or event vanished, and answering 204 would claim a shelving
    that did not happen, so it is re-raised (500).
    """
    ensure_owner(collection, user)
    ensure_collectable(db, event_ids=[event_id], user=user)

    try:
        with db.begin_nested():
            db.add(CollectionEvent(collection_id=collection.id, event_id=event_id))
    except IntegrityError as exc:
        if getattr(exc.orig, "pgcode", None) != _UNIQUE_VIOLATION:
            raise
        return
    db.commit()


def remove_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> None:
    """Take one event off ``collection``. Idempotent: a membership it never held is a no-op.

    403 for anyone but the owner. Eligibility is not re-checked, so an owner
    can always clear a membership whose event has since closed or been withheld.
    """
    ensure_owner(collection, user)
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
) -> list[tuple[Event, float | None, float | None]]:
    """One window of a collection's items, in the order the events happened.

    Returns ``(event, lat, lng)`` rows with coordinates in the same SELECT.
    ``joinedload`` for the owner, ``selectinload`` for the sets (a
    ``joinedload`` would row-multiply against the ``LIMIT``).

    ``limit`` is the caller's window: asking for one row past the page decides
    the ``Link: rel="next"``.
    """
    key = chronological_key()
    query = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
        )
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
        )
        .filter(CollectionEvent.collection_id == collection_id, collectable_events())
    )
    if cursor is not None:
        query = query.filter(keyset_after(key, cursor))
    return [(event, lat, lng) for event, lat, lng in query.order_by(*key).limit(limit).all()]


def list_owned_collections(
    db: Session,
    *,
    owner_id: uuid.UUID,
    include_empty: bool,
    page: int,
    per_page: int,
) -> tuple[list[Collection], int]:
    """One page of an analyst's collections, newest first, with the total.

    ``include_empty`` is the owner's view (empty collections are scaffolding);
    readers get only shelves with something on them. It narrows ``total`` too.

    Rows are :func:`visible_collections`, so a withheld collection is hidden
    from its owner as well; only an admin reads one, by id.
    """
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
    """Every collection ``owner`` holds, and whether ``event_id`` is on each.

    The add-to-collection popover's payload, in three statements: collections
    newest first, memberships of this event, and counts from :func:`stats_for`
    (so the number matches the collection's own page). Empty collections are
    included.
    """
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
    return [
        CollectionMembershipRead(
            id=collection.id,
            title=collection.title,
            event_count=stats.get(collection.id, _EMPTY_STATS).event_count,
            in_collection=collection.id in member_ids,
        )
        for collection in collections
    ]
