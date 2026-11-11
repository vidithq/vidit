import logging

from fastapi import APIRouter, Request

from app.dependencies import DB
from app.models.conflict import Conflict, event_conflicts
from app.models.event import Event
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.conflict import ConflictRead
from app.services.event_filters import visible_events
from app.services.pagination import REFERENTIAL_MAX_ROWS

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ConflictRead])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_conflicts(request: Request, db: DB, used: bool = False):
    """Return the conflicts referential, ongoing first then by name.

    The daily sync's sanity band bounds one parse pass, not the table (rows accumulate across
    passes), so ``REFERENTIAL_MAX_ROWS`` bounds the response. A response landing on it is logged
    because the payload can't say it was cut.
    """
    query = db.query(Conflict)
    if used:
        query = (
            query.join(event_conflicts, event_conflicts.c.conflict_id == Conflict.id)
            .join(Event, Event.id == event_conflicts.c.event_id)
            .filter(*visible_events())
            .distinct()
        )
    rows = (
        query.order_by(Conflict.is_ongoing.desc(), Conflict.name).limit(REFERENTIAL_MAX_ROWS).all()
    )
    if len(rows) == REFERENTIAL_MAX_ROWS:
        logger.warning(
            "GET /conflicts hit the %d-row referential ceiling; "
            "the response is truncated and the picker is missing options",
            REFERENTIAL_MAX_ROWS,
        )
    return rows
