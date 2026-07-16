from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.conflict import Conflict, event_conflicts
from app.models.event import Event
from app.ratelimit import limiter
from app.schemas.conflict import ConflictRead

router = APIRouter()


@router.get("", response_model=list[ConflictRead])
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
    """
    query = db.query(Conflict)
    if used:
        query = (
            query.join(event_conflicts, event_conflicts.c.conflict_id == Conflict.id)
            .join(Event, Event.id == event_conflicts.c.event_id)
            .filter(Event.deleted_at.is_(None))
            .distinct()
        )
    return query.order_by(Conflict.ongoing.desc(), Conflict.name).all()
