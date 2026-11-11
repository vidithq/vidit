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
from datetime import datetime
from typing import NamedTuple

from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.collection import Collection
from app.models.event import Event
from app.models.user import User
from app.schemas.collection import MAX_CREATE_EVENTS, SearchMatch
from app.services.collections import (
    TooManyEventsError,
    ensure_owned_live,
    insert_memberships,
    split_collectable,
)
from app.services.geolocator_credit import CREDIT_LOAD
from app.services.pagination import keyset_before
from app.services.search import collectable_matches
from app.services.thumbnails import thumbnail_loads


class BulkAddOutcome(NamedTuple):
    added: int
    already_in_collection: int
    not_collectable: int


def count_matches(db: Session, *, match: SearchMatch, user: User) -> int:
    match.filters.validate()
    return collectable_matches(db, query=match.q, filters=match.filters, user=user).count()


def list_matches(
    db: Session,
    *,
    match: SearchMatch,
    user: User,
    limit: int,
    after: tuple[datetime, uuid.UUID] | None = None,
) -> list[Event]:
    """One window of the events :func:`count_matches` counts, newest first, over-fetched by one
    row for ``pagination.paged``."""
    match.filters.validate()
    query = collectable_matches(
        db,
        Event,
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
    return query.order_by(Event.created_at.desc(), Event.id.desc()).limit(limit + 1).all()


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

    A match resolves server-side to the caller's collectable events only, so it skips nothing
    on that ground. ``exclude_event_ids`` leaves events out of the match before the cap counts
    it, and is itself capped like ``event_ids``.

    A row already present, or one a concurrent add writes first, counts as
    ``already_in_collection`` (:func:`services.collections.insert_memberships`).
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

    added = insert_memberships(db, collection_id=collection.id, event_ids=ids)
    db.commit()
    return BulkAddOutcome(
        added=added,
        already_in_collection=len(ids) - added,
        not_collectable=not_collectable,
    )
