"""The terminal write: withdraw, reject or retract an event."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_CLOSED, BeforeClosedStatus, Event
from app.models.user import User
from app.services.permissions import ensure_owner

from .errors import EventStateError


def close(db: Session, *, geo: Event, current_user: User, close_reason: str) -> Event:
    """Close an event (owner-only, any live state).

    ``before_closed_status`` records the state the row left:

    * ``requested``: a withdrawn call for help.
    * ``detected``: a rejected machine detection. It stays in the located
      catalog as an audit row and stays re-importable
      (see ``detection._row_disposition``).
    * ``geolocated``: a public retraction. The page stays readable with its
      id, credits, archives and versions, and leaves the published set, feeds
      and map (``event_filters.published_events`` and ``view_predicate``).

    The row stays publicly visible in every case. Nothing reopens a closed
    row, which is why the reason is required; the admin delete removes one.

    Raises :class:`EventStateError` (409) on a ``closed`` row. Commits and
    invalidates the points cache.
    """
    # Lock the row like ``geolocate`` and ``save_version``, so a concurrent
    # geolocate or version save lands wholly before or after this close.
    # ``populate_existing`` refreshes the identity-mapped row from the locked
    # SELECT before the owner and status re-checks.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status == STATUS_CLOSED:
        raise EventStateError("This event is already closed")
    # Safe: the guard above pins status to the BeforeClosedStatus domain.
    geo.before_closed_status = cast(BeforeClosedStatus, geo.status)
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = close_reason
    db.commit()
    db.refresh(geo)
    points_cache.invalidate()
    return geo
