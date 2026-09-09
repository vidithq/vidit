"""Batch completion: publish a selection of detections, one row at a time.

The queue shape of the geolocate transition. Each row commits in its own
transaction and reports its own verdict, so one detection failing the floor
leaves the rest of the selection published.
"""

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
# row, caught so it cannot take the rest of the batch down with it. Published as
# part of the contract (``docs/api.md``) because a client has to be able to tell
# "this detection is incomplete" from "retry this detection".
ROW_INTERNAL_ERROR_CODE = "internal_error"


@dataclass(frozen=True)
class DetectionCompletion:
    """One row's outcome in a batch completion.

    ``code`` is ``None`` on a published row and the failing
    :class:`EventError`'s stable code otherwise (or
    :data:`ROW_INTERNAL_ERROR_CODE` on a database failure), with ``message`` the
    human sentence the queue renders next to that row. A failed row is
    untouched: it stays a detection its owner can finish by hand.
    """

    event_id: uuid.UUID
    code: str | None = None
    message: str | None = None


def _assert_owns_all(db: Session, *, event_ids: list[uuid.UUID], current_user: User) -> None:
    """403 the whole call if any targeted row belongs to someone else.

    Run before the first row commits, so a batch that reaches for another
    analyst's detection publishes nothing. Ownership is the one condition treated
    this way: the ids come from the caller's own queue, so a foreign one is a
    broken client rather than a row-level data problem, and the per-row results
    stay about the evidence floor. A row that no longer exists is NOT an
    ownership failure; the loop reports it per row.
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
    """Promote one detection to ``geolocated`` on the evidence it
    already carries plus the two judgment calls the batch supplies.

    The completion counterpart of :func:`geolocate`: no field edits, no uploads,
    no proof rewrite. Everything the floor needs beyond the conflict and the
    capture-source tag is what the import already put on the row, so the whole
    transition is a tag write plus the state flip. It runs the SAME floor
    helpers as the single-row transition (:func:`_require_submission_media`,
    :func:`_require_proof_image`, :func:`_require_submission_floor`), which is
    the point: a batch must not be a second, looser door to ``geolocated``.

    Locked with ``with_for_update()`` + ``populate_existing()`` like
    :func:`geolocate`, so a batch racing a hand-submit of the same detection
    serializes and the loser sees the state error. Commits on success.

    The floor below is also what the detections queue filters on, projected
    into SQL by :func:`detection_ready_predicate`: change a leg here and change it
    there.

    Raises the typed floor errors, :class:`EventStateError` off ``detected``,
    :class:`EventNotFoundError` when the row is gone, and the 403 of
    :func:`ensure_owner` on a row the caller does not own. The caller rolls back
    and records the code against the row.
    """
    geo = (
        db.query(Event)
        # A withheld detection is frozen for its owner (same as the single-row
        # :func:`geolocate`, which resolves through ``_resolve_live_event``):
        # while an admin holds a row down, its owner does not get to move it on
        # to a published state.
        .filter(Event.id == event_id, *visible_events())
        .populate_existing()
        .with_for_update()
        .first()
    )
    if geo is None:
        raise EventNotFoundError("This detection no longer exists")
    # Re-checked here, not only in ``complete_detections``: the helper owns the
    # whole promotion, so it must be safe to call from a future entry point.
    ensure_owner(geo, current_user)
    if geo.status != STATUS_DETECTED:
        raise EventStateError("Only a detection can be completed in a batch")

    # The floor, in the order that puts the cheapest read first. Each miss is a
    # row the analyst has to open by hand, so the message names what to fix.
    if geo.source_url is None or not geo.source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")
    if geo.event_coords is None:
        raise CoordinatesRequiredError("This detection carries no coordinates")
    _require_submission_media(any(m.role == "source" for m in geo.media))
    # The proof-image leg: satisfied already when the import carried annotation
    # media, and the reason a row drops out of the batch when it did not.
    _require_proof_image(geo.proof)
    if capture_source_tag is None:
        raise TagRequirementsError("A capture source tag is required")

    # The batch sets exactly one capture source per row, so an imported one is
    # replaced rather than added to; every other tag the detection carries survives.
    effective_tags = [t for t in geo.tags if t.category != "capture_source"]
    effective_tags.append(capture_source_tag)
    _require_submission_floor(effective_tags, conflicts)

    # Same autoflush suppression as ``geolocate``: the collection assignments
    # lazy-load the current sets, which would flush a half-stamped row.
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
    """Publish a selection of detections in one call, row by row.

    The batch shape the import queue needs: an import is usually dominated by
    one conflict, so ``conflict_ids`` is set once for the whole selection, while
    the capture source varies detection to detection and rides per row (``rows`` is
    ordered ``(event_id, capture_source_tag_id)`` pairs). Everything else the
    floor demands is already on the row, which is what makes publishing an
    import cost one dropdown per detection instead of a form.

    One transaction PER ROW, deliberately: a detection that fails the floor rolls
    back alone and stays a detection, and the rest of the selection still publishes.
    The result list mirrors ``rows`` order, one :class:`DetectionCompletion` each.

    Two conditions fail the whole call instead, both before anything commits: an
    empty / unresolvable ``conflict_ids`` (:class:`TagRequirementsError`, since
    no row could clear the floor), and a row owned by someone else (403 from
    ``ensure_owner``). Nothing after the first commit can fail the call: a
    database error on one row is caught and reported as
    :data:`ROW_INTERNAL_ERROR_CODE` against that row.
    """
    conflicts = _resolve_conflicts(db, conflict_ids)
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    _assert_owns_all(db, event_ids=[event_id for event_id, _ in rows], current_user=current_user)

    # The selection draws its capture sources from one small curated set, so
    # resolve the distinct ids once rather than per row. A tag id that resolves
    # to nothing (or to a non-``capture_source`` tag) fails its own rows on the
    # floor, not the call.
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
        # The shared base, not ``EventError``: the media floor raises
        # ``evidence_intake``'s own ``MediaRequiredError``, which is a sibling
        # rather than a subclass, and it must land on its row like any other
        # floor miss.
        except EvidenceIntakeError as exc:
            db.rollback()
            outcomes.append(DetectionCompletion(event_id=event_id, code=exc.code, message=str(exc)))
            continue
        # Per-row isolation has to cover the unexpected too. A database failure
        # escaping here would 500 the whole call and throw away the verdicts of
        # every row already published, which is the one outcome the batch shape
        # exists to prevent. Logged with the row, reported as its own verdict.
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
