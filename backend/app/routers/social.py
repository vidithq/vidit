from dataclasses import replace

from fastapi import APIRouter, Query, Request, Response

from app.dependencies import DB, CurrentUser, Cursor
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._filters import Filters
from app.routers.events._common import build_event_list
from app.schemas.event import DateHistogram, FeedItemRead
from app.services import social
from app.services.event_filters import validate_status_filter
from app.services.pagination import (
    decode_cursor,
    encode_cursor,
    page_size,
    paged,
)
from app.services.social import FeedScope

router = APIRouter()


@router.get("/feed", response_model=list[FeedItemRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_feed(
    request: Request,
    response: Response,
    filters: Filters,
    db: DB,
    current_user: CurrentUser,
    scope: FeedScope = Query("following"),
    limit: int = Query(10, ge=1),
    cursor: Cursor = None,
    status: list[str] | None = Query(None),
) -> list[FeedItemRead]:
    """Published geolocations, open requests and machine detections, newest first.

    ``scope=following`` (default) keeps the geolocations credited to analysts
    the current user follows and the requests and detections they own, and is
    empty when they follow nobody; ``scope=all`` keeps every row. ``status`` and the filter set
    narrow the rows as on ``GET /events``. Cursor-paged, capped at 100
    rows; the ``Link: rel="next"`` cursor is present exactly when a next page holds a row.
    """
    validate_status_filter(status)
    size = page_size(limit)
    window = social.get_feed(
        db,
        user_id=current_user.id,
        scope=scope,
        size=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
        filters=replace(filters, status=status),
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r[1], r[0].id))
    return [FeedItemRead(**build_event_list(geo).model_dump(), feed_at=at) for geo, at in rows]


@router.get("/feed/dates", response_model=DateHistogram)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_feed_dates(
    request: Request,
    filters: Filters,
    db: DB,
    current_user: CurrentUser,
    scope: FeedScope = Query("following"),
    status: list[str] | None = Query(None),
) -> DateHistogram:
    """The rows ``GET /feed`` walks for the request, counted per day on each date axis.

    Takes the ``scope``, ``status`` and filters of ``GET /feed``. ``occurred_date`` ignores the
    request's own ``occurred_date_from`` / ``occurred_date_to`` and ``submitted`` its own
    ``submitted_from`` / ``submitted_to``. ``total`` counts the rows under every filter.
    """
    validate_status_filter(status)
    return DateHistogram.model_validate(
        social.get_feed_dates(
            db, user_id=current_user.id, scope=scope, filters=replace(filters, status=status)
        )
    )
