"""The terminal close: withdraw, reject or retract an event, in one verb."""

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
    """Close an event: withdraw, reject or retract it, in one verb.

    Owner-only, and available in all three live states.
    ``before_closed_status`` records which one the row left, so the badge, the
    read views and detection re-import can tell them apart:

    * off ``requested``, a withdrawn call for help.
    * off ``detected``, a rejected machine detection. It stays in the located
      catalog as an audit row and stays re-importable
      (see ``detection._row_disposition``).
    * off ``geolocated``, a public retraction of published work. The page stays
      readable and keeps its id, coordinate, credits, archives and version
      history, with the reason beside the closed badge; it leaves the published
      set, the feeds and the map (``event_filters.published_events`` and
      ``view_predicate``), and no machine touches it again.

    The row stays publicly visible in every case: a record that says why it was
    taken back is what a retraction is. Nothing here reopens a closed row, which
    is why the reason is required; removing a row for good is the admin delete.

    Raises :class:`EventStateError` (409) on a ``closed`` row, the terminal
    state. Commits, invalidates the points cache, returns the refreshed row.
    """
    # Serialize on the row like ``geolocate`` and ``save_version``: a
    # ``requested`` event is fulfillable by anyone, so a concurrent geolocate (a
    # different actor) could otherwise be silently overwritten by this close
    # reading a stale in-memory status, and a concurrent correction of a
    # published row must file its version either wholly before or wholly after
    # the retraction. ``populate_existing`` refreshes the identity-mapped row
    # from the freshly locked SELECT before the owner and status re-checks.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status == STATUS_CLOSED:
        raise EventStateError("This event is already closed")
    # Sound cast: the guard above pins status to the BeforeClosedStatus domain.
    geo.before_closed_status = cast(BeforeClosedStatus, geo.status)
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = close_reason
    db.commit()
    db.refresh(geo)
    points_cache.invalidate()
    return geo
