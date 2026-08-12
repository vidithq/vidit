from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import coords_or_none, thumbnail_media
from app.schemas.event import EventList, PaginatedEvents
from app.services import social
from app.services.pagination import decode_cursor, next_link, page_size

router = APIRouter()


@router.get("/timeline", response_model=PaginatedEvents)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_timeline(
    request: Request,
    response: Response,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedEvents:
    """Geolocations authored by accounts the current user follows.

    Empty when the user follows nobody: the frontend renders an empty-state
    instead of falling back to a global firehose, so the page stays a
    deliberate signal rather than a noisy default feed.

    Newest submission first, capped at 100 rows per page. ``cursor`` (from the
    ``Link: rel="next"`` header) is the supported way to read on; ``page`` is
    the offset path the feed's pager still uses.
    """
    per_page = page_size(per_page)
    result = social.get_timeline(
        db,
        user_id=current_user.id,
        page=page,
        per_page=per_page,
        cursor=decode_cursor(cursor) if cursor is not None else None,
    )
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
            media=thumbnail_media(geo),
            tags=geo.tags,
            conflicts=geo.conflicts,
        )
        for geo, lat, lng in result["items"]
    ]
    if result["has_next"]:
        last = result["items"][-1][0]
        response.headers["Link"] = next_link(request, last.created_at, last.id)
    return PaginatedEvents(items=items, total=result["total"], page=page, per_page=per_page)
