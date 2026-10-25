"""Read endpoints: list (located + requested views), the compact ``/points``
payload, and the filter / bbox / cache-key helpers behind them."""

import hashlib

import orjson
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
)
from fastapi.responses import Response
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import ColumnElement, func, not_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.cache import points_cache
from app.compression import precompress, precompressed_response
from app.dependencies import get_current_user, get_db
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
)
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import SOURCE_LOAD, build_event_list, build_event_read
from app.schemas.event import (
    EventList,
    EventListSort,
    PaginatedEventDetails,
)
from app.services.event_filters import (
    AUTHOR_FILTER_PATTERN,
    VIEWS,
    apply_filters,
    bbox_predicate,
    parse_bbox,
    snap_bbox,
    validate_media_types,
    validate_source_filters,
    validate_status_filter,
    visible_events,
)
from app.services.events import DETECTION_READINESS, detection_ready_predicate
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


def _build_points_cache_key(
    *,
    bbox: tuple[float, float, float, float],
    conflict: list[str] | None,
    source_kind: list[str] | None,
    level: list[str] | None,
    tag: list[str] | None,
    occurred_date_from: str | None,
    occurred_date_to: str | None,
    submitted_from: str | None,
    submitted_to: str | None,
    author: str | None,
    media: list[str] | None = None,
    approved: bool = False,
    approved_by: str | None = None,
    approved_by_org: str | None = None,
) -> str:
    """Hash the filter tuple into a collision-safe ``points_cache`` key.

    A structured ``orjson`` tuple makes separator collisions impossible (a
    colon-join would alias ``conflict="a:b"`` with ``conflict="a", tag="b"``).
    List filters are sorted so click order doesn't change the key.

    ``bbox`` is the box already snapped onto the server-side grid
    (:func:`snap_bbox`), never the raw client box: raw boxes key near-uniquely
    and would evict every other LRU entry. The same tuple builds the query
    predicate, so a cached payload is never served for a box it wasn't computed
    for.
    """
    payload = orjson.dumps(
        [
            list(bbox),
            sorted(conflict) if conflict else None,
            sorted(source_kind) if source_kind else None,
            sorted(level) if level else None,
            sorted(tag) if tag else None,
            occurred_date_from,
            occurred_date_to,
            submitted_from,
            submitted_to,
            author,
            sorted(media) if media else None,
            approved,
            approved_by.lower() if approved_by else None,
            approved_by_org.lower() if approved_by_org else None,
        ]
    )
    return f"points:{hashlib.sha256(payload).hexdigest()}"


@router.get("/points")
@authenticated_read_quota
@limiter.limit("60/minute")
def list_points(
    request: Request,
    # Required so the payload tracks the asked area; missing or malformed is a
    # 422. Uncapped because the map asks for the world box at low zoom.
    bbox: str = Query(..., description="south,west,north,east, four floats"),
    # Multi-value (``?tag=a&tag=b``); a single value parses to a one-item list.
    conflict: list[str] | None = Query(None),
    source_kind: list[str] | None = Query(None),
    level: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    occurred_date_from: str | None = None,
    occurred_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    # Multi-value; an event matches if it has any attachment of a listed type.
    media: list[str] | None = Query(None),
    approved: bool = False,
    approved_by: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    approved_by_org: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    db: Session = Depends(get_db),
):
    """Return the map's events inside ``bbox`` as a compact array:
    ``[[id, lat, lng, occurred_date, added_date, detected], ...]``.

    No joins, built for client-side clustering. ``bbox``
    (``south,west,north,east``) is required and bounds the payload by area; a
    missing or malformed value is a 422 (:func:`parse_bbox`). Live
    ``geolocated`` / ``detected`` rows with a subject coordinate only. Dates
    are ISO ``YYYY-MM-DD`` (``added_date`` is the ``created_at`` day);
    ``occurred_date`` is ``null`` when unknown. ``detected`` is a 1/0 flag, not a
    status string, to keep the payload small. Cached in memory for 60s per
    snapped bbox + filter combination (:func:`snap_bbox`), gzipped once at the
    miss so a hit costs no compression.
    """
    validate_media_types(media)
    validate_source_filters(source_kind, level)
    # Parse before any cache work so a malformed box 422s instead of being
    # cached. The snapped box feeds both the key and the predicate.
    bounds = snap_bbox(parse_bbox(bbox))
    cache_key = _build_points_cache_key(
        bbox=bounds,
        conflict=conflict,
        source_kind=source_kind,
        level=level,
        tag=tag,
        occurred_date_from=occurred_date_from,
        occurred_date_to=occurred_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
        approved=approved,
        approved_by=approved_by,
        approved_by_org=approved_by_org,
    )

    cached = points_cache.get(cache_key)
    if cached is not None:
        return precompressed_response(
            request, cached, {"Cache-Control": "public, max-age=30", "X-Cache": "HIT"}
        )

    q = db.query(
        Event.id,
        ST_Y(Event.coords).label("lat"),
        ST_X(Event.coords).label("lng"),
        Event.occurred_date,
        Event.created_at,
        Event.status,
    )
    q = apply_filters(
        q,
        conflict=conflict,
        source_kind=source_kind,
        level=level,
        tag=tag,
        occurred_date_from=occurred_date_from,
        occurred_date_to=occurred_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
        approved=approved,
        approved_by=approved_by,
        approved_by_org=approved_by_org,
    )
    # Map-only narrowing: a closed detection stays on the list but leaves the
    # map, and a pin needs a coordinate inside the viewport.
    q = q.filter(
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        Event.coords.isnot(None),
        bbox_predicate(bounds),
    )

    rows = q.all()
    # Compact 6-tuple; ``detected`` is a 1/0 flag to keep the no-LIMIT payload small.
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

    body = precompress(orjson.dumps(result))
    points_cache.set(cache_key, body)

    return precompressed_response(
        request, body, {"Cache-Control": "public, max-age=30", "X-Cache": "MISS"}
    )


@router.get("", response_model=list[EventList])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_events(
    request: Request,
    response: Response,
    view: str = Query("located"),
    # Multi-value, any-match; a single value parses to a one-item list.
    status: list[str] | None = Query(None),
    conflict: list[str] | None = Query(None),
    source_kind: list[str] | None = Query(None),
    level: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    bbox: str | None = None,
    occurred_date_from: str | None = None,
    occurred_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    approved: bool = Query(False, description="true: approved on the live version"),
    approved_by: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    approved_by_org: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    has_coords: bool | None = Query(None, description="true: with a location; false: without"),
    sort: EventListSort = Query("newest"),
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
):
    """Cards for one lifecycle view, newest or oldest first.

    ``view=located`` (default) is the catalog; ``view=requested`` the open-call
    queue. Two steps (ids, then full rows) so eager-loads can't inflate the
    LIMIT count.

    Capped at 100 rows however large ``limit`` is; the ``Link: rel="next"``
    cursor is present exactly when a next page holds a row. Ordering is
    ``created_at, id``, descending for ``sort=newest`` and ascending for
    ``sort=oldest``. Both are total, so a walk can't duplicate or skip rows.
    """
    if view not in VIEWS:
        raise HTTPException(
            status_code=422, detail=f"view must be one of: {', '.join(sorted(VIEWS))}"
        )
    validate_status_filter(status)
    validate_source_filters(source_kind, level)
    size = page_size(limit)

    # Step 1: ids with the limit (no row-inflating joins)
    id_query = apply_filters(
        db.query(Event.id, Event.created_at),
        view=view,
        status=status,
        conflict=conflict,
        source_kind=source_kind,
        level=level,
        tag=tag,
        occurred_date_from=occurred_date_from,
        occurred_date_to=occurred_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        approved=approved,
        approved_by=approved_by,
        approved_by_org=approved_by_org,
        bbox=bbox,
        has_coords=has_coords,
    )

    oldest = sort == "oldest"
    order = (
        (Event.created_at.asc(), Event.id.asc())
        if oldest
        else (Event.created_at.desc(), Event.id.desc())
    )
    if cursor is not None:
        after = decode_cursor(cursor)
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

    # Step 2: full objects + coordinates in one query
    rows = (
        db.query(
            Event,
            ST_Y(Event.coords).label("lat"),
            ST_X(Event.coords).label("lng"),
        )
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

    return [build_event_list(geo, lat=lat, lng=lng) for geo, lat, lng in rows]


@router.get("/detections", response_model=PaginatedEventDetails)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_detections(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    readiness: str = Query("all"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's ``detected`` events awaiting a publish, newest first.

    Owner-scoped to ``current_user`` (never a URL username): the Detections
    queue. Returns full ``EventRead`` so the queue shows evidence and what each
    detection still lacks without a per-row round-trip. Ordered by
    ``created_at DESC, id DESC``.

    ``readiness`` narrows the queue server-side to detections that clear the
    publish floor (``ready``), those that don't (``incomplete``), or ``all``;
    anything else is a 422. The floor is :func:`detection_ready_predicate`, the
    SQL projection of ``services/events/batch._publish_detection``. Filtering
    here, not over the loaded page, because the queue pages at 10 rows over
    imports of hundreds.

    ``total`` counts the filtered set; ``ready_total`` and ``incomplete_total``
    always count the whole queue. Offset-paged (``page`` / ``per_page``),
    capped at 100 rows per page.
    """
    if readiness not in DETECTION_READINESS:
        raise HTTPException(
            status_code=422,
            detail=f"readiness must be one of: {', '.join(sorted(DETECTION_READINESS))}",
        )
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
    total = {
        "ready": ready_total,
        "incomplete": incomplete_total,
        "all": ready_total + incomplete_total,
    }[readiness]

    page_filters: tuple[ColumnElement[bool], ...] = detected
    if readiness == "ready":
        page_filters = (*detected, ready)
    elif readiness == "incomplete":
        page_filters = (*detected, not_(ready))

    window = (
        db.query(
            Event,
            ST_Y(Event.coords).label("lat"),
            ST_X(Event.coords).label("lng"),
        )
        # Loader rule for every paged event query: ``selectinload`` for
        # many-to-many / one-to-many sets, since ``joinedload`` would
        # row-multiply against ``LIMIT`` and truncate the page. ``joinedload``
        # is safe only for many-to-one owner / requested_by.
        .options(
            joinedload(Event.owner),
            joinedload(Event.requested_by),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            *thumbnail_loads(),
            CREDIT_LOAD,
            SOURCE_LOAD,
            selectinload(Event.detection),
        )
        .filter(*page_filters)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    items = [build_event_read(geo, lat=lat, lng=lng) for geo, lat, lng in window.all()]

    return PaginatedEventDetails(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        ready_total=ready_total,
        incomplete_total=incomplete_total,
    )
