"""Bulk shelving: many of the caller's events onto one collection in one write.

Its own module because a search-named set reads ``services/search``, which
imports ``services/collections``. The rules are those of
:func:`services.collections.add_event`, with two differences:

* A state a collection does not show is skipped and counted, not refused,
  since a selection or a search can go stale between the read and the write.
* At most :data:`schemas.collection.MAX_CREATE_EVENTS` events per call
  (:class:`services.collections.TooManyEventsError` past it).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import NamedTuple

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.collection import Collection, CollectionEvent
from app.models.event import Event
from app.models.user import User
from app.schemas.collection import MAX_CREATE_EVENTS, SearchMatch
from app.services.collections import TooManyEventsError, ensure_owned_live, split_collectable
from app.services.geolocator_credit import CREDIT_LOAD
from app.services.pagination import keyset_before
from app.services.search import collectable_matches
from app.services.thumbnails import thumbnail_loads


class BulkAddOutcome(NamedTuple):
    """What one bulk add wrote and what it skipped."""

    added: int
    already_in_collection: int
    not_collectable: int


def count_matches(db: Session, *, match: SearchMatch, user: User) -> int:
    """How many of ``user``'s collectable events ``match`` lists (:func:`services.search.collectable_matches`)."""
    match.filters.validate()
    return collectable_matches(db, query=match.q, filters=match.filters, user=user).count()


def list_matches(
    db: Session,
    *,
    match: SearchMatch,
    user: User,
    limit: int,
    after: tuple[datetime, uuid.UUID] | None = None,
) -> list[tuple[Event, float | None, float | None]]:
    """One window of the events :func:`count_matches` counts, newest first (``created_at``,
    ``id``, both descending), over-fetched by one row for ``pagination.paged``.

    Returns ``(event, lat, lng)`` rows with the card loads of a collection's item page. ``after``
    is the decoded cursor of the previous page's last row.
    """
    match.filters.validate()
    query = collectable_matches(
        db,
        Event,
        ST_Y(Event.coords).label("lat"),
        ST_X(Event.coords).label("lng"),
        query=match.q,
        filters=match.filters,
        user=user,
    ).options(
        joinedload(Event.owner),
        selectinload(Event.tags),
        selectinload(Event.conflicts),
        *thumbnail_loads(),
        CREDIT_LOAD,
    )
    if after is not None:
        query = query.filter(keyset_before(Event.created_at, Event.id, after))
    rows = query.order_by(Event.created_at.desc(), Event.id.desc()).limit(limit + 1).all()
    return [(event, lat, lng) for event, lat, lng in rows]


def _too_many() -> TooManyEventsError:
    return TooManyEventsError(
        f"Add at most {MAX_CREATE_EVENTS} events at once; narrow the selection"
    )


def add_events(
    db: Session,
    *,
    collection: Collection,
    user: User,
    event_ids: Sequence[uuid.UUID] | None = None,
    match: SearchMatch | None = None,
    exclude_event_ids: Sequence[uuid.UUID] = (),
) -> BulkAddOutcome:
    """Put ``event_ids``, or the events ``match`` names, on ``collection``. One transaction.

    The collection must be the caller's (403). Ids run
    :func:`services.collections.split_collectable`: an unknown id is a 404 and an
    uncredited one a 403 for the whole call, a non-collectable one is skipped. A
    match resolves server-side to the caller's collectable events only, so it
    skips nothing on that ground. ``exclude_event_ids`` (match only, the schema
    refuses it beside ids) leaves those events out of the match before the cap
    counts it, and is itself capped like ``event_ids``.

    ``ON CONFLICT DO NOTHING`` on the membership key is the idempotency, so a row
    already present, or one a concurrent add writes first, counts as
    ``already_in_collection``.
    """
    ensure_owned_live(collection, user)
    if match is not None:
        match.filters.validate()
        if len(exclude_event_ids) > MAX_CREATE_EVENTS:
            raise _too_many()
        resolved = collectable_matches(db, query=match.q, filters=match.filters, user=user)
        if exclude_event_ids:
            resolved = resolved.filter(Event.id.notin_(exclude_event_ids))
        ids = [event_id for (event_id,) in resolved.limit(MAX_CREATE_EVENTS + 1)]
        if len(ids) > MAX_CREATE_EVENTS:
            raise _too_many()
        not_collectable = 0
    else:
        requested = list(event_ids or ())
        if len(requested) > MAX_CREATE_EVENTS:
            raise _too_many()
        ids, not_collectable = split_collectable(db, event_ids=requested, user=user)

    added = 0
    if ids:
        now = datetime.now(UTC)
        inserted = db.execute(
            insert(CollectionEvent)
            .values(
                [
                    {"collection_id": collection.id, "event_id": event_id, "added_at": now}
                    for event_id in ids
                ]
            )
            .on_conflict_do_nothing(index_elements=["collection_id", "event_id"])
            .returning(CollectionEvent.event_id)
        ).all()
        added = len(inserted)
    db.commit()
    return BulkAddOutcome(
        added=added,
        already_in_collection=len(ids) - added,
        not_collectable=not_collectable,
    )
