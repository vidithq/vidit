"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the multipart forms into clean Python types and
hand them to the functions here, which own every business rule, the S3 upload
loop, proof-image intake, the DB commit, and the post-commit S3 sweep on
rollback. The write verbs map one-to-one onto the lifecycle:
:func:`create_with_evidence` births a ``geolocated`` row, :func:`create_request`
a ``requested`` one, :func:`update_request` corrects an open request in place,
:func:`geolocate` is the one generalized transition to
``geolocated`` (fulfil a request, vouch a detection), :func:`save_version` corrects a
published row and files the superseded state as a version, and :func:`close`
is the terminal withdraw / reject / retract, available in every live state.

Errors are typed `EventError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/events/_common.py` (`_EVENT_ERROR_STATUS`), kept in sync
when adding a code.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import cast

from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_CLOSED, BeforeClosedStatus, Event
from app.models.user import User
from app.services.permissions import ensure_owner

from .batch import ROW_INTERNAL_ERROR_CODE, DetectionCompletion, complete_detections
from .coordinates import validate_coordinates
from .create import create_with_evidence
from .errors import (
    CoordinatesRequiredError,
    EventError,
    EventNotFoundError,
    EventStateError,
    InvalidCoordinatesError,
    InvalidProofError,
    NothingChangedError,
    ProofImageRequiredError,
    SourceUrlRequiredError,
    TagRequirementsError,
    TooManySourceLinksError,
)
from .geolocation import geolocate
from .readiness import DETECTION_READINESS, detection_ready_predicate
from .request import ImportProvenance, create_request, stamp_provenance, update_request
from .revision import save_version
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
    replace_source_links,
    truncate_secondary_source_urls,
)

__all__ = [
    "DETECTION_READINESS",
    "ROW_INTERNAL_ERROR_CODE",
    "CoordinatesRequiredError",
    "DetectionCompletion",
    "EventError",
    "EventNotFoundError",
    "EventStateError",
    "ImportProvenance",
    "InvalidCoordinatesError",
    "InvalidProofError",
    "NothingChangedError",
    "ProofImageRequiredError",
    "SourceUrlRequiredError",
    "TagRequirementsError",
    "TooManySourceLinksError",
    "build_source_link_rows",
    "close",
    "complete_detections",
    "create_request",
    "create_with_evidence",
    "detection_ready_predicate",
    "geolocate",
    "normalize_secondary_source_urls",
    "pair_secondary_snapshots",
    "replace_source_links",
    "save_version",
    "stamp_provenance",
    "truncate_secondary_source_urls",
    "update_request",
    "validate_coordinates",
]

logger = logging.getLogger(__name__)


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
