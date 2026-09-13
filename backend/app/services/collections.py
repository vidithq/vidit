"""Personal collections: create, curate, and read.

A collection is a named set of one analyst's own events, shown on the owner's
public profile. Two rules hold everywhere in this module:

* **What a collection may show is one predicate.**
  :func:`services.event_filters.collectable_events` decides it, and the item
  page, the count, the date range, the card mosaic and the add verb's
  eligibility check all read it. A row that closes, is taken down or is
  soft-deleted therefore leaves every one of them at once, with no write to
  ``collection_events``.
* **An event joins its owner's collection only.** The invariant spans two
  tables, so no SQL constraint carries it: :func:`add_event` enforces it with
  the same :func:`services.permissions.ensure_owner` every owner-only verb
  uses, which means an attempt to shelve somebody else's event is a 403.

A collection stores no file of its own: the picture its profile card wears is
the mosaic :func:`cover_tiles_for` reads off the items at request time, so
there is nothing to upload, nothing to replace and nothing to sweep.
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
from app.models.user import User
from app.schemas.collection import (
    CollectionCoverTile,
    CollectionMembershipRead,
    CollectionRead,
)
from app.services.event_filters import collectable_events
from app.services.pagination import keyset_after
from app.services.permissions import ensure_owner
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


COLLECTION_ERROR_STATUS: dict[str, int] = {
    "collection_not_found": 404,
    "event_not_found": 404,
    "event_not_collectable": 409,
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


# How many tiles the profile card's mosaic holds. Four, the playlist-icon
# shape: one item fills the slot, two split it, three and four fill it as a
# grid, and a fifth would make each tile too small to read at a card's width.
COVER_TILES = 4


def _has_thumbnail_media() -> ColumnElement[bool]:
    """Correlated EXISTS: this event carries media a card may show.

    The same rows :func:`services.thumbnails.thumbnail_media_criteria` names,
    asked as a predicate on the event. It is what keeps an item carrying no
    showable media out of the ranking, so a collection whose earliest items
    are text-only still fills its mosaic from the ones that follow.
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

    The card-thumbnail pick (:func:`services.thumbnails.pick_thumbnail`) with
    one difference that belongs to this surface alone: where that pick returns
    the item's ``source`` row whatever its kind, a mosaic tile prefers an image
    over a clip. A tile is a quarter of a card and never plays, so a still frame
    says more there than a poster frame does, and an item holding a source clip
    beside a proof image has a picture to offer. The preference lives here
    rather than in ``pick_thumbnail``, which every other card surface reads and
    which must go on naming the item's own footage.
    """
    picked = pick_thumbnail(rows)
    if picked is None or picked.media_type == "image":
        return picked
    return next((row for row in rows if row.media_type == "image"), picked)


def cover_tiles_for(
    db: Session, collection_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[CollectionCoverTile]]:
    """The mosaic each collection wears, up to :data:`COVER_TILES` tiles.

    The rule, one home: walk the items the collection may show
    (:func:`services.event_filters.collectable_events`) in the chronological
    order its own page lists them in, skip an item flagged ``is_graphic``, take
    one tile per remaining item from its card media (:func:`_tile_media`), and
    stop at four. A graphic item is skipped rather than ending the walk, so a
    collection whose earliest event carries hard footage still wears a mosaic
    and no reader meets death or injury on a card they did not open. A
    collection with nothing showable gets an empty list, which is the card's
    placeholder.

    Two statements for a whole page of collections, however many rows it holds.
    The first ranks each collection's eligible items by the chronological key
    with a window function and keeps the first four, so the ranking happens once
    in the database rather than once per card; the second is the eager load of
    those items' media. The alternative, one query per collection, costs a
    round trip per card on a surface that pages four at a time.
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
            CollectionCoverTile(url=media.storage_url, media_type=media.media_type)
        )
    return tiles


def build_collection_reads(db: Session, collections: Sequence[Collection]) -> list[CollectionRead]:
    """Assemble the read payload for a page of collections.

    The single assembler, so a collection is the same shape on its own page,
    on a profile and in a create response. Both readings are batched over the
    whole page: the stats come from one grouped query, the mosaics from one
    ranked query, so the assembler costs the same few statements for four
    cards as for one.
    """
    collection_ids = [collection.id for collection in collections]
    stats = stats_for(db, collection_ids)
    tiles = cover_tiles_for(db, collection_ids)
    return [
        CollectionRead(
            id=collection.id,
            owner=collection.owner,
            title=collection.title,
            description=collection.description,
            cover=tiles.get(collection.id, []),
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


def create_collection(db: Session, *, owner: User, title: str, description: str) -> Collection:
    """Open a new, empty collection for ``owner``, named and described."""
    collection = Collection(owner_id=owner.id, title=title, description=description)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


def update_collection_details(
    db: Session, *, collection: Collection, user: User, title: str, description: str
) -> Collection:
    """Write ``collection``'s title and description. 403 for anyone but the owner.

    One verb for the pair rather than one per field: they are what the
    collection says about itself, the edit panel carries both, and saving them
    together is what keeps a renamed collection from describing the old one.
    """
    ensure_owner(collection, user)
    collection.title = title
    collection.description = description
    db.commit()
    db.refresh(collection)
    return collection


def delete_collection(db: Session, *, collection: Collection, user: User) -> None:
    """Drop ``collection``, leaving every event it held untouched.

    403 for anyone but the owner. The membership rows go with it through the
    cascade; the events themselves are the analyst's published record and a
    collection is only a view over them, so nothing else has to be reached.
    """
    ensure_owner(collection, user)
    db.delete(collection)
    db.commit()


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
