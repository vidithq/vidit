from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._filters import event_filters
from app.routers.events._common import build_event_list
from app.schemas.event import DateHistogram, FeedItemRead
from app.services import social
from app.services.event_filters import EventFilters
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
    filters: EventFilters = Depends(event_filters),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[FeedItemRead]:
    """Published geolocations, open requests and machine detections, newest first.

    ``scope=following`` (default) keeps the geolocations credited to analysts
    the current user follows and the requests and detections they own, and is
    empty when they follow nobody; ``scope=all`` keeps every row. ``kind``
    (``geolocation``, ``request``, ``detected``; all three when omitted) keeps those kinds,
    and the filter set narrows the rows as on ``GET /events``. Cursor-paged, capped at 100
    rows; the ``Link: rel="next"`` cursor is present exactly when a next page holds a row.
    """
    size = page_size(limit)
    window = social.get_feed(
        db,
        user_id=current_user.id,
        scope=scope,
        size=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
        kind=kind,
        filters=filters,
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r[3], r[0].id))
    return [
        FeedItemRead(**build_event_list(geo, lat=lat, lng=lng).model_dump(), feed_at=at)
        for geo, lat, lng, at in rows
    ]


@router.get("/feed/dates", response_model=DateHistogram)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_feed_dates(
    request: Request,
    scope: FeedScope = Query("following"),
    kind: list[FeedKind] | None = Query(None),
    filters: EventFilters = Depends(event_filters),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DateHistogram:
    """The rows ``GET /feed`` walks for the request, counted per day on each date axis.

    Takes the ``scope``, ``kind`` and filters of ``GET /feed``. ``occurred_date`` ignores the
    request's own ``occurred_date_from`` / ``occurred_date_to`` and ``submitted`` its own
    ``submitted_from`` / ``submitted_to``.
    """
    return DateHistogram.model_validate(
        social.get_feed_dates(db, user_id=current_user.id, scope=scope, kind=kind, filters=filters)
    )
