import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.conflict import Conflict, event_conflicts
from app.models.event import Event
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.conflict import ConflictRead
from app.services.pagination import REFERENTIAL_MAX_ROWS

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ConflictRead])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_conflicts(
    request: Request,
    used: bool = False,
    db: Session = Depends(get_db),
):
    """Return the conflicts referential, ongoing first then by name.

    The default returns every row: the submit picker needs the full
    referential up front (ongoing conflicts plus the ended ones behind its
    "include ended" toggle) so an analyst geolocating archival footage can
    tag it. The referential is server-managed (Wikipedia sync + Wikidata
    seed + operator rows); there is no create endpoint.

    ``used=true`` flips to the map-filter view: only conflicts carried by at
    least one live event, so the filter UI never surfaces a chip that matches
    zero results. Mirrors the orphan filter on ``GET /tags``.

    Bounded by ``REFERENTIAL_MAX_ROWS``, not by the 100-row list cap: the
    submit picker filters the whole referential client-side, so a page of it
    would be a page of missing options. The daily sync's sanity band bounds
    one parse pass, not the table: rows accumulate across passes (an ended
    conflict is kept, and the Wikidata seed and operator rows add their own),
    so the ceiling is what bounds the response. A response landing on it is
    logged, since the payload carries no way to say it was cut.
    """
    query = db.query(Conflict)
    if used:
        query = (
            query.join(event_conflicts, event_conflicts.c.conflict_id == Conflict.id)
            .join(Event, Event.id == event_conflicts.c.event_id)
            .filter(Event.deleted_at.is_(None))
            .distinct()
        )
    rows = query.order_by(Conflict.ongoing.desc(), Conflict.name).limit(REFERENTIAL_MAX_ROWS).all()
    if len(rows) == REFERENTIAL_MAX_ROWS:
        logger.warning(
            "GET /conflicts hit the %d-row referential ceiling; "
            "the response is truncated and the picker is missing options",
            REFERENTIAL_MAX_ROWS,
        )
    return rows
