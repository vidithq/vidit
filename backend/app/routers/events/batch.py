"""Batch completion: publish a selection of detections in one call.

The import queue's bulk door. A machine detection lands with its title,
coordinates, source and (usually) its proof images already filled, so the only
thing standing between an imported thread and a published geolocation is the
judgment the machine can't supply: the conflict and the capture source. This
endpoint takes those two, once for the selection and once per row, and runs
each detection through the same evidence floor as
``POST /events/{id}/geolocate``.

Per-row transactions, per-row verdicts: the response says which detections
published and why each of the others stayed unpublished.
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

    JSON, not multipart: nothing uploads here. The detections keep the evidence the
    import gave them, and the call supplies only the conflict set (once, for the
    whole selection) and one ``capture_source`` tag per row.

    Each row commits on its own, so a mixed selection publishes what it can: a
    detection that fails the floor (no proof image, no source media, no
    coordinates, no source URL) rolls back alone and stays a detection with its
    reason in ``rows[]``. Publishing a row credits the caller as its
    geolocator, exactly as the single-row transition does.

    Two conditions reject the whole call, before anything is published: no
    resolvable conflict (400, since no row could clear the floor) and a
    targeted detection owned by another analyst (403). Rows are owner-only, so
    there is no fulfil-someone-else's-detection path here.
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
