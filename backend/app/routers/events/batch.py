"""Batch completion: publish a selection of detections in one call.

A detection arrives with title, coordinates, source and usually proof images;
what the machine can't supply is the conflict and the capture source. This
endpoint takes those (conflicts once for the selection, capture source per row)
and runs each detection through the same evidence floor as
``POST /events/{id}/geolocate``. Transactions and verdicts are per row.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers.events._common import _raise_event_error
from app.schemas.event import (
    BatchCompletionCreate,
    BatchCompletionRead,
    BatchCompletionRowRead,
)
from app.services import events as events_service
from app.services.evidence_intake import EvidenceIntakeError

router = APIRouter()


@router.post("/batch-complete", response_model=BatchCompletionRead)
@limiter.limit("10/minute")
def batch_complete_events(
    request: Request,
    body: BatchCompletionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BatchCompletionRead:
    """Publish the selected detections: ``detected`` → ``geolocated``.

    JSON, not multipart: nothing uploads. The detections keep their imported
    evidence; the call supplies the conflict set and one ``capture_source`` tag
    per row.

    Each row commits on its own: one that fails the floor (no proof image,
    source media, coordinates or source URL) rolls back alone, stays a
    detection and gets its reason in ``rows[]``. Publishing credits the caller
    as geolocator, as the single-row transition does.

    Two conditions reject the whole call before anything publishes: no
    resolvable conflict (400) and a targeted detection owned by another
    analyst (403; rows are owner-only).
    """
    try:
        outcomes = events_service.complete_detections(
            db,
            current_user=current_user,
            conflict_ids=body.conflict_ids,
            rows=[(row.event_id, row.capture_source_tag_id) for row in body.rows],
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)

    rows = [
        BatchCompletionRowRead(
            event_id=outcome.event_id,
            published=outcome.code is None,
            code=outcome.code,
            message=outcome.message,
        )
        for outcome in outcomes
    ]
    published = sum(1 for row in rows if row.published)
    return BatchCompletionRead(published=published, failed=len(rows) - published, rows=rows)
