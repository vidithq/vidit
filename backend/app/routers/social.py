from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import build_event_list
from app.schemas.event import FeedItemRead
from app.services import social
from app.services.pagination import (
    decode_cursor,
    encode_cursor,
    next_link,
    page_size,
)
from app.services.social import FeedScope

router = APIRouter()


@router.get("/feed", response_model=list[FeedItemRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_feed(
    request: Request,
    response: Response,
    scope: FeedScope = Query("following"),
    limit: int = Query(10, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[FeedItemRead]:
    """Published geolocations and open requests, newest first.

    ``scope=following`` (default) keeps the rows owned by analysts the
    current user follows, and is empty when they follow nobody; ``scope=all``
    keeps every row. Cursor-paged, capped at 100 rows; the ``Link: rel="next"``
    cursor is present exactly when a next page holds a row.
    """
    size = page_size(limit)
    rows, has_next = social.get_feed(
        db,
        user_id=current_user.id,
        scope=scope,
        size=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
    )
    if has_next:
        last, _, _, last_at = rows[-1]
        response.headers["Link"] = next_link(request, encode_cursor(last_at, last.id))
    return [
        FeedItemRead(**build_event_list(geo, lat=lat, lng=lng).model_dump(), feed_at=at)
        for geo, lat, lng, at in rows
    ]
