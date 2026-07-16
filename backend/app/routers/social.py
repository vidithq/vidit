from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers.events._common import coords_or_none, source_media
from app.schemas.event import EventList, PaginatedEvents
from app.services import social

router = APIRouter()


@router.get("/timeline", response_model=PaginatedEvents)
@limiter.limit("120/minute")
def get_timeline(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedEvents:
    """Geolocations authored by accounts the current user follows.

    Empty when the user follows nobody — the frontend renders an empty-state
    instead of falling back to a global firehose, so the page stays a
    deliberate signal rather than a noisy default feed.
    """
    result = social.get_timeline(db, user_id=current_user.id, page=page, per_page=per_page)
    items = [
        EventList(
            id=geo.id,
            title=geo.title,
            event_coords=coords_or_none(lat, lng),
            event_date=geo.event_date,
            is_demo=geo.is_demo,
            status=geo.status,
            before_closed_status=geo.before_closed_status,
            owner=geo.owner,
            media=source_media(geo),
            tags=geo.tags,
            conflicts=geo.conflicts,
        )
        for geo, lat, lng in result["items"]
    ]
    return PaginatedEvents(items=items, total=result["total"], page=page, per_page=per_page)
