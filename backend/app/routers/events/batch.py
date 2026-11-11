"""Batch completion: publish a selection of detections in one call."""

from fastapi import APIRouter, Request

from app.dependencies import DB, CurrentUser
from app.ratelimit import limiter
from app.schemas.event import BatchCompletionCreate, BatchCompletionRead
from app.services import events as events_service

router = APIRouter()


@router.post("/batch-complete", response_model=BatchCompletionRead)
@limiter.limit("10/minute")
def batch_complete_events(
    request: Request, body: BatchCompletionCreate, current_user: CurrentUser, db: DB
) -> BatchCompletionRead:
    """Publish the selected detections: ``detected`` → ``geolocated``."""
    rows = events_service.complete_detections(
        db,
        current_user=current_user,
        conflict_ids=body.conflict_ids,
        rows=[(row.event_id, row.kind) for row in body.rows],
    )
    published = sum(1 for row in rows if row.published)
    return BatchCompletionRead(published=published, failed=len(rows) - published, rows=rows)
