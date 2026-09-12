"""Personal collections: create, curate, read, and cover.

A collection is a named set of one analyst's own events, shown on the owner's
public profile. Two rules hold everywhere in this module:

* **What a collection may show is one predicate.**
  :func:`services.event_filters.collectable_events` decides it, and the item
  page, the count, the date range, the default cover and the add verb's
  eligibility check all read it. A row that closes, is taken down or is
  soft-deleted therefore leaves every one of them at once, with no write to
  ``collection_events``.
* **An event joins its owner's collection only.** The invariant spans two
  tables, so no SQL constraint carries it: :func:`add_event` enforces it with
  the same :func:`services.permissions.ensure_owner` every owner-only verb
  uses, which means an attempt to shelve somebody else's event is a 403.

The cover mirrors the profile picture (``services/users``): store the image,
point the column at it, commit, then delete the object the column used to
point at, the commit-then-sweep ordering :func:`services.storage.sweep_keys`
states.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime, time
from typing import Any, NamedTuple

from fastapi import UploadFile
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.collection import Collection, CollectionEvent
from app.models.event import Event
from app.models.user import User
from app.schemas.collection import CollectionMembershipRead, CollectionRead
from app.services.event_filters import collectable_events
from app.services.pagination import keyset_after
from app.services.permissions import ensure_owner
from app.services.storage import get_storage, sweep_keys, upload_collection_cover_image
from app.services.thumbnails import pick_thumbnail, thumbnail_media_criteria


class CollectionError(Exception):
    """A collection write or read the rules refuse.

    Carries a stable ``code`` so the router maps it to a status without
    matching on prose, the same contract as
    :class:`app.services.evidence_intake.EvidenceIntakeError`.
    """

    code: str = "collection_not_found"


class CollectionNotFoundError(CollectionError):
    """No collection with that id is readable by this caller."""

    code = "collection_not_found"


class EventNotFoundError(CollectionError):
    """No event with that id exists at all."""

    code = "event_not_found"


class EventNotCollectableError(CollectionError):
    """The event exists but a collection may not hold it."""

    code = "event_not_collectable"


class CoverError(CollectionError):
    """The submitted file cannot become a cover image."""

    code = "invalid_cover"


COLLECTION_ERROR_STATUS: dict[str, int] = {
    "collection_not_found": 404,
    "event_not_found": 404,
    "event_not_collectable": 409,
    "invalid_cover": 422,
}


# Stand-ins for a missing event date and a missing hour, so the chronological
# order is NULLS LAST and the keyset stays one row comparison (a comparison
# against NULL is unknown, which would drop the page cut). Both are the top of
# their domain, so an item missing its date sorts after every dated one and an
# item missing its hour after every timed one on the same day. A real event
# dated 9999-12-31 would tie with an undated one; the ``created_at, id`` tail
# still orders the tie totally, so a page walk can neither repeat a row nor
# skip one.
NO_DATE = date(9999, 12, 31)
NO_TIME = time(23, 59, 59, 999999)

# How many rows the add-to-collection popover lists. An analyst's shelf is a
# small set, and the popover shows it whole rather than paging; the cap is
# what keeps the payload bounded if one ever grows past it.
MAX_POPOVER_COLLECTIONS = 100


def chronological_key() -> tuple[Any, ...]:
    """The sort key a collection's items read by, as SQL expressions.

    ``event_date``, then ``event_time``, then ``created_at``, then ``id``,
    ascending, the first two through their stand-ins above. One home for the
    tuple because three callers have to agree on it exactly: the ``ORDER BY``,
    the keyset predicate that cuts a page out of that order
    (:func:`services.pagination.keyset_after`), and the cursor the page hands
    back. ``created_at`` and ``id`` make the ordering total, so items sharing
    a date and an hour still have one order.
    """
    return (
        func.coalesce(Event.event_date, NO_DATE),
        func.coalesce(Event.event_time, NO_TIME),
        Event.created_at,
        Event.id,
    )


def cursor_values(event: Event) -> tuple[date, time, datetime, uuid.UUID]:
    """The sort values of one item, for the cursor that names it.

    The Python side of :func:`chronological_key`: the same stand-ins, so the
    values a page ends on are the values the next page's predicate compares
    against.
    """
    return (
        event.event_date or NO_DATE,
        event.event_time or NO_TIME,
        event.created_at,
        event.id,
    )


class CollectionStats(NamedTuple):
    """What a collection's items add up to at read time.

    ``first_date`` and ``last_date`` are the smallest and largest
    ``event_date`` among the items, both ``None`` when the collection holds no
    item carrying one.
    """

    event_count: int
    first_date: date | None
    last_date: date | None


_EMPTY_STATS = CollectionStats(event_count=0, first_date=None, last_date=None)


def _items_of(collection_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    """The filter pair naming the events one collection may show."""
    return (CollectionEvent.collection_id == collection_id, collectable_events())


def _has_showable_item() -> ColumnElement[bool]:
    """Correlated EXISTS: this collection holds at least one showable event.

    An EXISTS rather than a count, because the list only asks whether a
    collection is empty. Applied to the rows and to the ``total`` alike, so a
    pager over a stranger's profile never counts a collection the list drops.
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

    One statement for a whole page of collections rather than three per row.
    A collection holding nothing showable has no group, so it is absent from
    the mapping; callers read it through :func:`stats_of`.
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


def stats_of(stats: dict[uuid.UUID, CollectionStats], collection_id: uuid.UUID) -> CollectionStats:
    """One collection's stats out of a :func:`stats_for` mapping, zeros if absent."""
    return stats.get(collection_id, _EMPTY_STATS)


def default_cover_url(db: Session, collection_id: uuid.UUID) -> str | None:
    """The cover a collection shows when its owner has set none.

    The media of the first item in chronological order that is not flagged
    graphic, picked by the card-thumbnail rule
    (:func:`services.thumbnails.pick_thumbnail`). Items flagged graphic are
    skipped rather than ending the search, so a collection whose earliest
    event carries hard footage still gets a cover, and no reader is shown
    death or injury on a card they did not open. ``None`` when no item
    qualifies.
    """
    row = (
        db.query(Event)
        .select_from(CollectionEvent)
        .join(Event, Event.id == CollectionEvent.event_id)
        .options(selectinload(Event.media.and_(thumbnail_media_criteria())))
        .filter(*_items_of(collection_id), Event.is_graphic.is_(False))
        .order_by(*chronological_key())
        .limit(1)
        .first()
    )
    if row is None:
        return None
    media = pick_thumbnail(row.media)
    return media.storage_url if media is not None else None


def cover_url(db: Session, collection: Collection) -> str | None:
    """Where the cover image of one collection lives, or ``None``.

    The owner's uploaded cover when ``cover_key`` holds one, resolved through
    the media host the way every other stored object is
    (:meth:`services.storage.Storage.public_url`); otherwise the default
    (:func:`default_cover_url`).
    """
    if collection.cover_key:
        return get_storage().public_url(collection.cover_key)
    return default_cover_url(db, collection.id)


def build_collection_reads(db: Session, collections: Sequence[Collection]) -> list[CollectionRead]:
    """Assemble the read payload for a page of collections.

    The single assembler, so a collection is the same shape on its own page,
    on a profile and in a create response. The stats come from one grouped
    query; the default cover is one query per collection that has no uploaded
    one, which is what a shelf of a few cards costs.
    """
    stats = stats_for(db, [collection.id for collection in collections])
    return [
        CollectionRead(
            id=collection.id,
            owner=collection.owner,
            title=collection.title,
            cover_url=cover_url(db, collection),
            cover_is_uploaded=bool(collection.cover_key),
            event_count=stats_of(stats, collection.id).event_count,
            first_date=stats_of(stats, collection.id).first_date,
            last_date=stats_of(stats, collection.id).last_date,
            created_at=collection.created_at,
        )
        for collection in collections
    ]


def build_collection_read(db: Session, collection: Collection) -> CollectionRead:
    """The read payload for one collection, through the page assembler."""
    return build_collection_reads(db, [collection])[0]


def resolve_collection(db: Session, *, collection_id: uuid.UUID, viewer: User | None) -> Collection:
    """Fetch a readable collection by id, or raise :class:`CollectionNotFoundError`.

    A withheld collection (``hidden_at``) reads as not found for everyone but
    an admin, who still has to read what was taken down in order to judge it,
    the same branch ``GET /events/{id}`` takes. A collection whose owner is
    soft-deleted reads the same way: the owner's own profile 404s, so their
    shelf cannot stay open beside it.
    """
    query = db.query(Collection).options(joinedload(Collection.owner))
    query = query.filter(Collection.id == collection_id)
    if viewer is None or not viewer.is_admin:
        query = query.filter(
            Collection.hidden_at.is_(None),
            Collection.owner.has(User.deleted_at.is_(None)),
        )
    collection = query.first()
    if collection is None:
        raise CollectionNotFoundError("Collection not found")
    return collection


def create_collection(db: Session, *, owner: User, title: str) -> Collection:
    """Open a new, empty collection for ``owner``."""
    collection = Collection(owner_id=owner.id, title=title)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


def rename_collection(db: Session, *, collection: Collection, user: User, title: str) -> Collection:
    """Give ``collection`` a new title. 403 for anyone but the owner."""
    ensure_owner(collection, user)
    collection.title = title
    db.commit()
    db.refresh(collection)
    return collection


def delete_collection(db: Session, *, collection: Collection, user: User) -> None:
    """Drop ``collection``, leaving every event it held untouched.

    403 for anyone but the owner. The membership rows go with it through the
    cascade; the events themselves are the analyst's published record and a
    collection is only a view over them. The cover object is swept after the
    commit, since nothing points at it once the row is gone.
    """
    ensure_owner(collection, user)
    collection_id = collection.id
    previous_cover = collection.cover_key
    db.delete(collection)
    db.commit()
    _sweep_cover(previous_cover, context=f"collection {collection_id} deleted")


def add_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> bool:
    """Put one event on ``collection``. Idempotent: ``False`` if already there.

    Three refusals, in order. The collection is the caller's or it is a 403.
    The event is the caller's too, the ownership invariant, or it is a 403 as
    well. And a collection may only hold a visible, worked row
    (:func:`services.event_filters.collectable_events`), so a request, a
    closed row, a takedown or a soft-deleted row is a 409: the event exists
    and the caller owns it, but its state is not one a curated shelf shows. An
    id matching no event at all is a 404.

    The idempotency shape is ``services/social.follow_user``'s: check, then
    stage the INSERT in a SAVEPOINT so the loser of a race rolls back its own
    statement and answers idempotently instead of poisoning the transaction.
    """
    ensure_owner(collection, user)
    event = db.query(Event).filter(Event.id == event_id).first()
    if event is None:
        raise EventNotFoundError("Event not found")
    ensure_owner(event, user)
    showable = db.query(Event.id).filter(Event.id == event_id, collectable_events()).first()
    if showable is None:
        raise EventNotCollectableError("This event is not one a collection can hold")

    existing = (
        db.query(CollectionEvent)
        .filter(
            CollectionEvent.collection_id == collection.id,
            CollectionEvent.event_id == event_id,
        )
        .first()
    )
    if existing is not None:
        return False
    try:
        with db.begin_nested():
            db.add(CollectionEvent(collection_id=collection.id, event_id=event_id))
    except IntegrityError:
        return False
    db.commit()
    return True


def remove_event(db: Session, *, collection: Collection, event_id: uuid.UUID, user: User) -> bool:
    """Take one event off ``collection``. Idempotent: ``False`` if it was not there.

    403 for anyone but the owner. The event is untouched: removing it from a
    shelf is not a judgement on the geolocation. Eligibility is not re-checked
    either, so an owner can always clear a membership whose event has since
    closed or been withheld.
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
        return False
    db.delete(row)
    db.commit()
    return True


def list_items(
    db: Session,
    *,
    collection_id: uuid.UUID,
    limit: int,
    cursor: tuple[date, time, datetime, uuid.UUID] | None = None,
) -> list[tuple[Event, float | None, float | None]]:
    """One window of a collection's items, in the order the events happened.

    Returns ``(event, lat, lng)`` rows, the shape every paged event surface
    hands its card assembler, with both coordinates projected in the same
    SELECT so the page costs no query per row. The loaders are the paged-query
    rule: ``joinedload`` for the many-to-one owner, ``selectinload`` for the
    sets, which a ``joinedload`` would row-multiply against the ``LIMIT``.

    ``limit`` is the caller's window, so a router asking for one row past its
    page is what decides whether a ``Link: rel="next"`` goes out.
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
        .filter(*_items_of(collection_id))
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

    ``include_empty`` is the owner's own view: a collection with nothing
    showable in it is scaffolding the owner is still filling, so a reader gets
    the shelves that have something on them and the owner gets all of theirs.
    The flag narrows the ``total`` as well as the rows, so the pager describes
    the set it is walking.

    Withheld collections are in neither view, the owner's included: a takedown
    freezes a collection for its owner too, exactly as it does an event, and
    only an admin reads one, by its id.
    """
    query = db.query(Collection).options(joinedload(Collection.owner))
    query = query.filter(Collection.owner_id == owner_id, Collection.hidden_at.is_(None))
    if not include_empty:
        query = query.filter(_has_showable_item())
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

    The add-to-collection popover's payload, read in three statements however
    many rows come back: the caller's collections newest first, the
    memberships of this one event among them, and the item count per
    collection out of the same grouped query a page of cards reads
    (:func:`stats_for`), so the number the popover prints under a title is the
    number that collection's own page prints. Empty collections are in it,
    since putting the first event on one is what the popover is for.
    """
    collections = (
        db.query(Collection)
        .filter(Collection.owner_id == owner.id, Collection.hidden_at.is_(None))
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
            event_count=stats_of(stats, collection.id).event_count,
            in_collection=collection.id in member_ids,
        )
        for collection in collections
    ]


def _sweep_cover(cover_key: str | None, *, context: str) -> None:
    """Delete the object a replaced or dropped ``cover_key`` named, if any."""
    if not cover_key:
        return
    sweep_keys([cover_key], context=context)


async def set_cover(
    db: Session, *, collection: Collection, user: User, file: UploadFile
) -> Collection:
    """Store ``file`` as ``collection``'s cover and drop the previous one.

    403 for anyone but the owner. Raises :class:`CoverError` when the file is
    not an image this codebase accepts, is over the image size ceiling, or
    cannot be decoded.
    """
    ensure_owner(collection, user)
    try:
        key = await upload_collection_cover_image(file, collection.id)
    except ValueError as exc:
        raise CoverError(str(exc)) from exc

    previous = collection.cover_key
    collection.cover_key = key
    try:
        db.commit()
    except Exception:
        # The object landed before the row did. Roll back, then sweep it so a
        # failed write never leaves an addressable image with nothing pointing
        # at it.
        db.rollback()
        _sweep_cover(key, context=f"collection {collection.id} cover commit failed")
        raise
    db.refresh(collection)
    _sweep_cover(previous, context=f"collection {collection.id} cover replaced")
    return collection


def clear_cover(db: Session, *, collection: Collection, user: User) -> Collection:
    """Drop ``collection``'s uploaded cover, column and stored object both.

    403 for anyone but the owner. The card then falls back to the default
    (:func:`default_cover_url`).
    """
    ensure_owner(collection, user)
    previous = collection.cover_key
    collection.cover_key = None
    db.commit()
    db.refresh(collection)
    _sweep_cover(previous, context=f"collection {collection.id} cover cleared")
    return collection


def owned_cover_keys(db: Session, owner_id: uuid.UUID) -> list[str]:
    """Every cover object one analyst's collections hold.

    Read before a GDPR hard delete: ``collections.owner_id`` cascades, so the
    rows go on their own, and this is what lets the sweep reach the objects
    they pointed at, the way an avatar is swept
    (:func:`services.admin.hard_delete_user`).
    """
    return [
        key
        for (key,) in db.query(Collection.cover_key)
        .filter(Collection.owner_id == owner_id, Collection.cover_key.isnot(None))
        .all()
        if key
    ]
