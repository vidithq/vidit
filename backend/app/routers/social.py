from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import build_event_list
from app.schemas.event import FeedItemRead
from app.services import social
from app.services.event_filters import AUTHOR_FILTER_PATTERN
from app.services.pagination import (
    decode_cursor,
    encode_cursor,
    page_size,
    paged,
)
from app.services.social import FeedKind, FeedScope

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
    kind: list[FeedKind] | None = Query(None),
    conflict: list[str] | None = Query(None),
    capture_source: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    approved: bool = Query(False),
    approved_by: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    approved_by_org: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[FeedItemRead]:
    """Published geolocations and open requests, newest first.

    ``scope=following`` (default) keeps the geolocations credited to analysts
    the current user follows and the requests they own, and is empty when they
    follow nobody; ``scope=all`` keeps every row. ``kind``, ``conflict``,
    ``capture_source``, ``tag``, ``approved``, ``approved_by`` and
    ``approved_by_org`` narrow the rows as on ``GET /events``. Cursor-paged, capped at 100 rows; the
    ``Link: rel="next"`` cursor is present exactly when a next page holds a row.
    """
    size = page_size(limit)
    window = social.get_feed(
        db,
        user_id=current_user.id,
        scope=scope,
        size=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
        kind=kind,
        conflict=conflict,
        capture_source=capture_source,
        tag=tag,
        approved=approved,
        approved_by=approved_by,
        approved_by_org=approved_by_org,
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r[3], r[0].id))
    return [
        FeedItemRead(**build_event_list(geo, lat=lat, lng=lng).model_dump(), feed_at=at)
        for geo, lat, lng, at in rows
    ]
