"""The batch completion: publish a selection of detections, row by row."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.conflict import Conflict
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.tag import Tag
from app.models.user import User
from app.services.event_filters import visible_events
from app.services.evidence_intake import EvidenceIntakeError
from app.services.permissions import ensure_owner

from .errors import (
    CoordinatesRequiredError,
    EventNotFoundError,
    EventStateError,
    SourceUrlRequiredError,
    TagRequirementsError,
)
from .rules import (
    _credit_geolocator,
    _require_proof_image,
    _require_submission_floor,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
)

logger = logging.getLogger(__name__)


# The one per-row code that is not a floor verdict: a database failure on that
# row. Part of the contract (``docs/api.md``): clients tell "incomplete" from "retry".
ROW_INTERNAL_ERROR_CODE = "internal_error"


@dataclass(frozen=True)
class DetectionCompletion:
    """One row's outcome: ``code`` is ``None`` when published, else the failing
    error's code (or :data:`ROW_INTERNAL_ERROR_CODE`). A failed row is untouched."""

    event_id: uuid.UUID
    code: str | None = None
    message: str | None = None


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
    capture_source_tag: Tag | None,
    conflicts: list[Conflict],
) -> None:
    """Promote one detection to ``geolocated`` with the conflict and capture tag the batch supplies.

    No field edits, uploads or proof rewrite: the import already put the rest on
    the row. It runs the same floor helpers as :func:`geolocate`, so a batch is
    no looser a door to ``geolocated``.

    Locked like :func:`geolocate`, so a race with a hand-submit serializes.
    Commits on success. The floor is projected into SQL by
    :func:`detection_ready_predicate`: change a leg in both.

    Raises the typed floor errors, :class:`EventStateError` off ``detected``,
    :class:`EventNotFoundError` when the row is gone, and the 403 of
    :func:`ensure_owner`. The caller rolls back and records the code.
    """
    geo = (
        db.query(Event)
        # A withheld detection is frozen for its owner, as in :func:`geolocate`.
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
    if geo.source_url is None or not geo.source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")
    if geo.event_coords is None:
        raise CoordinatesRequiredError("This detection carries no coordinates")
    _require_submission_media(any(m.role == "source" for m in geo.media))
    _require_proof_image(geo.proof)
    if capture_source_tag is None:
        raise TagRequirementsError("A capture source tag is required")

    # One capture source per row: an imported one is replaced, other tags survive.
    effective_tags = [t for t in geo.tags if t.category != "capture_source"]
    effective_tags.append(capture_source_tag)
    _require_submission_floor(effective_tags, conflicts)

    # As in ``geolocate``: lazy-loading the collections would flush a half-stamped row.
    with db.no_autoflush:
        geo.tags = effective_tags
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
    rows: list[tuple[uuid.UUID, uuid.UUID]],
) -> list[DetectionCompletion]:
    """Publish a selection of detections, one transaction per row.

    ``conflict_ids`` applies to the whole selection; ``rows`` are ordered
    ``(event_id, capture_source_tag_id)`` pairs. A row that fails the floor
    rolls back alone and stays a detection. Results mirror ``rows`` order.

    Two conditions fail the whole call before anything commits: an empty or
    unresolvable ``conflict_ids`` (:class:`TagRequirementsError`) and a row
    owned by someone else (403). After the first commit, a database error on
    one row is reported as :data:`ROW_INTERNAL_ERROR_CODE` against that row.
    """
    conflicts = _resolve_conflicts(db, conflict_ids)
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    _assert_owns_all(db, event_ids=[event_id for event_id, _ in rows], current_user=current_user)

    # Resolve the distinct tag ids once. An unresolvable or non-``capture_source``
    # tag fails its own rows on the floor, not the call.
    tags_by_id = {tag.id: tag for tag in _resolve_tags(db, list({tag_id for _, tag_id in rows}))}

    outcomes: list[DetectionCompletion] = []
    published = 0
    for event_id, tag_id in rows:
        try:
            _publish_detection(
                db,
                event_id=event_id,
                current_user=current_user,
                capture_source_tag=tags_by_id.get(tag_id),
                conflicts=conflicts,
            )
        # The shared base, not ``EventError``: ``MediaRequiredError`` is a sibling of it.
        except EvidenceIntakeError as exc:
            db.rollback()
            outcomes.append(DetectionCompletion(event_id=event_id, code=exc.code, message=str(exc)))
            continue
        # A database failure escaping would 500 the call and lose the verdicts of
        # rows already published.
        except SQLAlchemyError:
            db.rollback()
            logger.exception("batch completion failed on event %s", event_id)
            outcomes.append(
                DetectionCompletion(
                    event_id=event_id,
                    code=ROW_INTERNAL_ERROR_CODE,
                    message="This detection could not be published; try it again.",
                )
            )
            continue
        published += 1
        outcomes.append(DetectionCompletion(event_id=event_id))

    if published:
        points_cache.invalidate()
    return outcomes
