"""The batch completion: publish a selection of detections, row by row."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.conflict import Conflict
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.source import SourceKind
from app.models.user import User
from app.schemas.event import BatchCompletionRowRead
from app.services import versions
from app.services.event_filters import visible_events
from app.services.evidence_intake import EvidenceIntakeError
from app.services.permissions import ensure_owner

from .errors import (
    CoordinatesRequiredError,
    EventNotFoundError,
    EventStateError,
    SourceLinkRequiredError,
)
from .rules import _credit_geolocator, _require_conflict, _require_proof_image, _resolve_conflicts
from .sources import check_publish_floor, stored_floor

logger = logging.getLogger(__name__)


# The one per-row code that is not a floor verdict: a database failure on that
# row. Part of the contract (``docs/api.md``): clients tell "incomplete" from "retry".
ROW_INTERNAL_ERROR_CODE = "internal_error"


def _assert_owns_all(db: Session, *, event_ids: list[uuid.UUID], current_user: User) -> None:
    """403 the whole call if any targeted row belongs to someone else.

    Runs before the first commit. The ids come from the caller's own queue, so
    a foreign one is a broken client, not a row-level verdict. A vanished row
    is reported per row by the loop.
    """
    for row in (
        db.query(Event.id, Event.owner_id)
        .filter(Event.id.in_(event_ids), Event.deleted_at.is_(None))
        .all()
    ):
        ensure_owner(row, current_user)


def _publish_detection(
    db: Session,
    *,
    event_id: uuid.UUID,
    current_user: User,
    kind: SourceKind,
    conflicts: list[Conflict],
) -> None:
    """Promote one detection to ``geolocated`` with the conflicts and source kind the batch
    supplies, on the floor :func:`save_version` runs on a publish. Commits on success.

    Locked like :func:`save_version`, so a race with a publish from the form serializes. The
    floor is projected into SQL by :func:`detection_ready_predicate`: change a leg in both.
    """
    geo = (
        db.query(Event)
        # A withheld detection is frozen for its owner, as in :func:`save_version`.
        .filter(Event.id == event_id, *visible_events())
        .populate_existing()
        .with_for_update()
        .first()
    )
    if geo is None:
        raise EventNotFoundError("This detection no longer exists")
    # Re-checked here so the helper is safe from any entry point.
    ensure_owner(geo, current_user)
    if geo.status != STATUS_DETECTED:
        raise EventStateError("Only a detection can be completed in a batch")

    # The floor, cheapest read first; each message names what to fix.
    if geo.coords is None:
        raise CoordinatesRequiredError("This detection carries no coordinates")
    _require_proof_image(geo.proof)
    if any(not source.links for source in geo.sources):
        raise SourceLinkRequiredError("Every source needs a URL")
    check_publish_floor(stored_floor(geo.sources))

    # Filed before any field moves: the snapshot reads the live row.
    versions.file_version(db, geo=geo, edited_by=current_user, note=None)
    # As in ``save_version``: lazy-loading the collections would flush a half-stamped row.
    with db.no_autoflush:
        for source in geo.sources:
            if source.media is not None:
                source.kind = kind
        geo.conflicts = conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    _credit_geolocator(db, geo, current_user)
    db.commit()
    db.refresh(geo)


def complete_detections(
    db: Session,
    *,
    current_user: User,
    conflict_ids: list[uuid.UUID],
    rows: list[tuple[uuid.UUID, SourceKind]],
) -> list[BatchCompletionRowRead]:
    """Publish a selection of detections, one transaction per row, verdicts in ``rows`` order."""
    conflicts = _resolve_conflicts(db, conflict_ids)
    _require_conflict(conflicts)
    _assert_owns_all(db, event_ids=[event_id for event_id, _ in rows], current_user=current_user)

    outcomes: list[BatchCompletionRowRead] = []
    for event_id, kind in rows:
        code: str | None = None
        message: str | None = None
        try:
            _publish_detection(
                db,
                event_id=event_id,
                current_user=current_user,
                kind=kind,
                conflicts=conflicts,
            )
        # The shared base, not ``EventError``: the upload errors are siblings of it.
        except EvidenceIntakeError as exc:
            db.rollback()
            code, message = exc.code, str(exc)
        # A database failure escaping would 500 the call and lose the verdicts of
        # rows already published.
        except SQLAlchemyError:
            db.rollback()
            logger.exception("batch completion failed on event %s", event_id)
            code = ROW_INTERNAL_ERROR_CODE
            message = "This detection could not be published; try it again."
        outcomes.append(
            BatchCompletionRowRead(
                event_id=event_id, published=code is None, code=code, message=message
            )
        )

    if any(outcome.published for outcome in outcomes):
        points_cache.invalidate()
    return outcomes
