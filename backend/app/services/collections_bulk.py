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

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.collection import Collection, CollectionEvent
from app.models.user import User
from app.schemas.collection import MAX_CREATE_EVENTS, SearchMatch
from app.services.collections import TooManyEventsError, ensure_owned_live, split_collectable
from app.services.search import collectable_matches


class BulkAddOutcome(NamedTuple):
    """What one bulk add wrote and what it skipped."""

    added: int
    already_in_collection: int
    not_collectable: int


def count_matches(db: Session, *, match: SearchMatch, user: User) -> int:
    """How many of ``user``'s collectable events ``match`` lists (:func:`services.search.collectable_matches`)."""
    match.filters.validate()
    return collectable_matches(db, query=match.q, filters=match.filters, user=user).count()


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
) -> BulkAddOutcome:
    """Put ``event_ids``, or the events ``match`` names, on ``collection``. One transaction.

    The collection must be the caller's (403). Ids run
    :func:`services.collections.split_collectable`: an unknown id is a 404 and an
    uncredited one a 403 for the whole call, a non-collectable one is skipped. A
    match resolves server-side to the caller's collectable events only, so it
    skips nothing on that ground.

    ``ON CONFLICT DO NOTHING`` on the membership key is the idempotency, so a row
    already present, or one a concurrent add writes first, counts as
    ``already_in_collection``.
    """
    ensure_owned_live(collection, user)
    if match is not None:
        match.filters.validate()
        ids = [
            event_id
            for (event_id,) in collectable_matches(
                db, query=match.q, filters=match.filters, user=user
            ).limit(MAX_CREATE_EVENTS + 1)
        ]
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
