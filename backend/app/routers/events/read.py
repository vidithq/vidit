import hashlib
from dataclasses import asdict, replace

import orjson
from fastapi import (
    APIRouter,
    Query,
    Request,
)
from fastapi.responses import Response
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import func, not_
from sqlalchemy.orm import selectinload

from app.cache import points_cache
from app.dependencies import DB, CurrentUser, Cursor
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
)
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._filters import Filters
from app.routers.events._common import DETAIL_LOADS, build_event_list, build_event_read
from app.schemas.event import (
    EventList,
    EventListSort,
    PaginatedEventDetails,
)
from app.services.event_filters import (
    EventFilters,
    EventView,
    bbox_predicate,
    parse_bbox,
    snap_bbox,
    validate_status_filter,
    visible_events,
)
from app.services.events import DetectionReadiness, detection_ready_predicate
from app.services.geolocator_credit import CREDIT_LOAD
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_cursor,
    encode_cursor,
    keyset_after,
    keyset_before,
    page_size,
    paged,
)
from app.services.thumbnails import thumbnail_loads

router = APIRouter()


def _points_cache_key(bbox: tuple[float, float, float, float], filters: EventFilters) -> str:
    """Hash the snapped box and the filter set into a collision-safe ``points_cache`` key.

    A structured ``orjson`` payload makes separator collisions impossible (a
    colon-join would alias ``conflict="a:b"`` with ``conflict="a", tag="b"``).
    List filters are sorted so click order doesn't change the key, and the
    approver names are lower-cased since they match case-insensitively.

    ``bbox`` is the box already snapped onto the server-side grid
    (:func:`snap_bbox`), never the raw client box: raw boxes key near-uniquely
    and would evict every other LRU entry. The same tuple builds the query
    predicate, so a cached payload is never served for a box it wasn't computed
    for.
    """
    normalised = asdict(filters)
    for name, value in normalised.items():
        if isinstance(value, list):
            normalised[name] = sorted(value) if value else None
        elif name in ("approved_by", "approved_by_org") and value:
            normalised[name] = value.lower()
    payload = orjson.dumps([list(bbox), normalised], option=orjson.OPT_SORT_KEYS)
    return f"points:{hashlib.sha256(payload).hexdigest()}"


@router.get("/points")
@authenticated_read_quota
@limiter.limit("60/minute")
def list_points(
    request: Request,
    filters: Filters,
    db: DB,
    # Required so the payload tracks the asked area; missing or malformed is a
    # 422. Uncapped because the map asks for the world box at low zoom.
    bbox: str = Query(..., description="south,west,north,east, four floats"),
):
    """Return the map's events inside ``bbox`` as a compact array:
    ``[[id, lat, lng, occurred_date, added_date, detected], ...]``."""
    # Parse before any cache work so a malformed box 422s instead of being
    # cached. The snapped box feeds both the key and the predicate.
    bounds = snap_bbox(parse_bbox(bbox))
    cache_key = _points_cache_key(bounds, filters)

    cached_bytes = points_cache.get(cache_key)
    if cached_bytes is not None:
        return _points_response(cached_bytes, "HIT")

    q = db.query(
        Event.id,
        ST_Y(Event.coords).label("lat"),
        ST_X(Event.coords).label("lng"),
        Event.occurred_date,
        Event.created_at,
        Event.status,
    )
    q = filters.apply(q, view="located")
    # Map-only narrowing: a closed detection stays on the list but leaves the
    # map, and a pin needs a coordinate inside the viewport.
    q = q.filter(
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        Event.coords.isnot(None),
        bbox_predicate(bounds),
    )

    rows = q.all()
    result = [
        [
            str(r.id),
            float(r.lat),
            float(r.lng),
            r.occurred_date.isoformat() if r.occurred_date else None,
            r.created_at.date().isoformat(),
            1 if r.status == STATUS_DETECTED else 0,
        ]
        for r in rows
    ]

    json_bytes = orjson.dumps(result)
    points_cache.set(cache_key, json_bytes)
    return _points_response(json_bytes, "MISS")


def _points_response(content: bytes, cache: str) -> Response:
    return Response(
        content=content,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=30", "X-Cache": cache},
    )


@router.get("", response_model=list[EventList])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_events(
    request: Request,
    response: Response,
    filters: Filters,
    db: DB,
    view: EventView = Query("located"),
    # Multi-value, any-match; a single value parses to a one-item list.
    status: list[str] | None = Query(None),
    bbox: str | None = None,
    sort: EventListSort = Query("newest"),
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
):
    """Cards for one lifecycle view, newest or oldest first.

    Two steps (ids, then full rows) so eager-loads can't inflate the LIMIT count.
    """
    validate_status_filter(status)
    size = page_size(limit)

    id_query = replace(filters, status=status).apply(
        db.query(Event.id, Event.created_at), view=view
    )
    if bbox:
        id_query = id_query.filter(bbox_predicate(parse_bbox(bbox)))

    oldest = sort == "oldest"
    order = (
        (Event.created_at.asc(), Event.id.asc())
        if oldest
        else (Event.created_at.desc(), Event.id.desc())
    )
    after = decode_cursor(cursor)
    if after is not None:
        id_query = id_query.filter(
            keyset_after((Event.created_at, Event.id), after)
            if oldest
            else keyset_before(Event.created_at, Event.id, after)
        )

    window = id_query.order_by(*order).limit(size + 1).all()
    keys = paged(request, response, window, size, lambda k: encode_cursor(k.created_at, k.id))

    if not keys:
        return []

    ids = [key.id for key in keys]

    rows = (
        db.query(Event)
        .options(
            # ``selectinload``, never ``subqueryload``: with ``.and_()`` criteria
            # subqueryload loses the outer correlation on a compiled-cache hit
            # and the media branch scans the whole table (~4s per request).
            selectinload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            *thumbnail_loads(),
            CREDIT_LOAD,
        )
        .filter(Event.id.in_(ids))
        # Same ordering as the id window, so the page matches the cursor.
        .order_by(*order)
        .all()
    )

    return [build_event_list(geo) for geo in rows]


@router.get("/detections", response_model=PaginatedEventDetails)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_detections(
    request: Request,
    current_user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    readiness: DetectionReadiness = Query("all"),
):
    """The caller's ``detected`` events awaiting a publish, newest first."""
    # Over-large sizes are clamped; below 1 is a 422 at ``Query(ge=1)`` (a
    # non-positive LIMIT / negative OFFSET would be a Postgres 500).
    per_page = page_size(per_page)

    detected = (
        Event.owner_id == current_user.id,
        Event.status == STATUS_DETECTED,
        *visible_events(),
    )
    ready = detection_ready_predicate()

    # Both counts in one ``FILTER`` pass; the filtered total derives from them.
    ready_total, incomplete_total = (
        db.query(
            func.count().filter(ready),
            func.count().filter(not_(ready)),
        )
        .select_from(Event)
        .filter(*detected)
        .one()
    )
    total, page_filters = {
        "all": (ready_total + incomplete_total, detected),
        "ready": (ready_total, (*detected, ready)),
        "incomplete": (incomplete_total, (*detected, not_(ready))),
    }[readiness]

    window = (
        db.query(Event)
        .options(*DETAIL_LOADS)
        .filter(*page_filters)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    items = [build_event_read(geo) for geo in window.all()]

    return PaginatedEventDetails(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        ready_total=ready_total,
        incomplete_total=incomplete_total,
    )
