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
from app.dependencies import get_current_user, get_db
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
)
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import build_event_list, build_event_read
from app.schemas.event import (
    EventList,
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
    validate_status_filter,
    visible_events,
)
from app.services.events import DETECTION_READINESS, detection_ready_predicate
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_cursor,
    encode_cursor,
    keyset_before,
    next_link,
    page_size,
    take_page,
)
from app.services.thumbnails import thumbnail_media_criteria

router = APIRouter()


def _build_points_cache_key(
    *,
    bbox: tuple[float, float, float, float],
    conflict: list[str] | None,
    capture_source: list[str] | None,
    tag: list[str] | None,
    event_date_from: str | None,
    event_date_to: str | None,
    submitted_from: str | None,
    submitted_to: str | None,
    author: str | None,
    media: list[str] | None = None,
) -> str:
    """Hash the filter tuple into a collision-safe ``points_cache`` key.

    The previous colon-join (``f"points:{conflict}:{tag}:..."``) collapsed
    any colon-carrying value to the same key — ``conflict="a:b"`` vs
    ``conflict="a", tag="b"`` — so the second request silently served the
    first's cached payload. Hashing a structured ``orjson`` tuple makes
    separator collisions impossible and bounds key length.

    List-shaped filters (``conflict``, ``tag``) are sorted before
    serialisation so the same logical filter set hashes alike regardless
    of the order the chips were clicked.

    ``bbox`` is the float tuple already snapped onto the server-side grid
    (:func:`snap_bbox`), never the raw client box: raw boxes arrive at the
    client's own precision, so they key near-uniquely and a caller cycling
    a low decimal would evict every other entry from the LRU. Snapped, two
    viewports in the same cell share an entry, and because the same tuple
    also builds the query predicate, a cached payload can never be served
    for a box it wasn't computed for.
    """
    payload = orjson.dumps(
        [
            list(bbox),
            sorted(conflict) if conflict else None,
            sorted(capture_source) if capture_source else None,
            sorted(tag) if tag else None,
            event_date_from,
            event_date_to,
            submitted_from,
            submitted_to,
            author,
            sorted(media) if media else None,
        ]
    )
    return f"points:{hashlib.sha256(payload).hexdigest()}"


@router.get("/points")
@authenticated_read_quota
@limiter.limit("60/minute")
def list_points(
    request: Request,
    # Required, so the payload tracks the area the caller asked for. The map's
    # own path is viewport-sized, and a missing or malformed value is a 422:
    # sweeping the catalog now costs a deliberate world-sized parameter rather
    # than a bare GET. Nothing caps the area, because the map legitimately asks
    # for the world box at low zoom.
    bbox: str = Query(..., description="south,west,north,east, four floats"),
    # ``conflict``, ``capture_source`` and ``tag`` accept multiple values
    # (``?tag=a&tag=b``); a single ``?tag=a`` parses to ``["a"]``, so older
    # single-select clients keep working.
    conflict: list[str] | None = Query(None),
    capture_source: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    event_date_from: str | None = None,
    event_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    # ``media`` accepts multiple values (``?media=image&media=video``); an event
    # matches if it has any attachment of a listed type.
    media: list[str] | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return the map's events inside ``bbox`` as a compact array:
    ``[[id, lat, lng, event_date, added_date, detected], ...]``.
    No joins, designed for map display with client-side clustering.
    ``bbox`` (``south,west,north,east``) is required and bounds the payload
    by the area asked for rather than by catalog size; a missing or malformed
    value returns 422 (see :func:`parse_bbox` for the accepted shape).
    Live ``geolocated`` / ``detected`` rows with a subject coordinate only: a
    ``requested`` guess is not a confident pin, and a closed row was judged
    out. ``event_date`` and ``added_date`` (the ``created_at`` calendar day)
    are ISO ``YYYY-MM-DD`` strings; ``event_date`` is ``null`` when unknown
    (the column is optional) and the frontend then leaves that point out of
    the event-date scrubber instead of hiding it. The frontend buckets the
    dates for the two timeline scrubbers and filters the windows client-side
    (no refetch per drag). ``detected`` is ``1`` for a machine detection
    (rendered marked), ``0`` for a geolocated row: a flag, not a status string,
    to keep the payload small. Cached in-memory for 60s per unique
    bbox + filter combination, the bbox first snapped outward onto a fixed
    server-side grid (see :func:`snap_bbox`).
    """
    validate_media_types(media)
    # Parse before any cache work: a malformed box must 422 rather than key
    # (and cache) off a string the query would never run with. Snap once, then
    # use the snapped box for both the key and the predicate, so the cached
    # payload always covers exactly the box its key names.
    bounds = snap_bbox(parse_bbox(bbox))
    cache_key = _build_points_cache_key(
        bbox=bounds,
        conflict=conflict,
        capture_source=capture_source,
        tag=tag,
        event_date_from=event_date_from,
        event_date_to=event_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
    )

    cached_bytes = points_cache.get(cache_key)
    if cached_bytes is not None:
        return Response(
            content=cached_bytes,
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=30", "X-Cache": "HIT"},
        )

    q = db.query(
        Event.id,
        ST_Y(Event.event_coords).label("lat"),
        ST_X(Event.event_coords).label("lng"),
        Event.event_date,
        Event.created_at,
        Event.status,
    )
    q = apply_filters(
        q,
        conflict=conflict,
        capture_source=capture_source,
        tag=tag,
        event_date_from=event_date_from,
        event_date_to=event_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
    )
    # Map-only narrowing on top of the located view: a closed detection stays
    # on the list (audit trail) but comes off the map, a coordinate is
    # required for a pin at all, and the viewport bounds the rest.
    q = q.filter(
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        Event.event_coords.isnot(None),
        bbox_predicate(bounds),
    )

    rows = q.all()
    # Compact 6-tuple: [id, lat, lng, event_date, added_date, detected].
    # ``detected`` is a 1/0 flag (not a status string) so the no-LIMIT payload
    # stays small; the map colours the marker off it.
    result = [
        [
            str(r.id),
            float(r.lat),
            float(r.lng),
            r.event_date.isoformat() if r.event_date else None,
            r.created_at.date().isoformat(),
            1 if r.status == STATUS_DETECTED else 0,
        ]
        for r in rows
    ]

    json_bytes = orjson.dumps(result)
    points_cache.set(cache_key, json_bytes)

    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=30", "X-Cache": "MISS"},
    )


@router.get("", response_model=list[EventList])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_events(
    request: Request,
    response: Response,
    view: str = Query("located"),
    # ``status`` accepts multiple values (``?status=a&status=b``, any-match);
    # a single ``?status=a`` parses to ``["a"]``, so older single-select
    # callers keep working.
    status: list[str] | None = Query(None),
    conflict: list[str] | None = Query(None),
    capture_source: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    bbox: str | None = None,
    event_date_from: str | None = None,
    event_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(None, pattern=AUTHOR_FILTER_PATTERN),
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
):
    """Newest-first cards for one lifecycle view.

    ``view=located`` (default) is the catalog; ``view=requested`` the open-call
    queue (ex ``/requests``). Two-step "ids then full rows" shape so eager-loads
    can't inflate the LIMIT count.

    Capped at 100 rows however large ``limit`` is; a caller reading past the
    first page follows the ``cursor`` in the ``Link: rel="next"`` header, which
    is present exactly when a next page holds at least one row. Ordering is
    ``created_at DESC, id DESC``, total by construction, so a walk cannot
    duplicate or skip a row when rows land mid-walk.
    """
    if view not in VIEWS:
        raise HTTPException(
            status_code=422, detail=f"view must be one of: {', '.join(sorted(VIEWS))}"
        )
    validate_status_filter(status)
    size = page_size(limit)

    # Step 1: get IDs with limit (no joins that inflate rows)
    id_query = apply_filters(
        db.query(Event.id, Event.created_at),
        view=view,
        status=status,
        conflict=conflict,
        capture_source=capture_source,
        tag=tag,
        event_date_from=event_date_from,
        event_date_to=event_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        bbox=bbox,
    )

    if cursor is not None:
        id_query = id_query.filter(keyset_before(Event.created_at, Event.id, decode_cursor(cursor)))

    # One row past the page: presence of the extra row is what decides whether
    # a ``Link: rel="next"`` goes out at all.
    window = id_query.order_by(Event.created_at.desc(), Event.id.desc()).limit(size + 1).all()
    keys, has_next = take_page(window, size)

    if not keys:
        return []

    ids = [key.id for key in keys]
    if has_next:
        last = keys[-1]
        response.headers["Link"] = next_link(request, encode_cursor(last.created_at, last.id))

    # Step 2: load full objects + coordinates in one query
    rows = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
        )
        .options(
            # ``selectinload`` (IN on the page's ids), never ``subqueryload``:
            # combined with ``.and_()`` criteria, subqueryload loses the outer
            # query's correlation when SQLAlchemy serves the statement from its
            # compiled cache, and the media branch degrades into a scan of the
            # whole table (~4s per request on a populated database).
            selectinload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
        )
        .filter(Event.id.in_(ids))
        # Same total ordering as the id window above, so the hydrated page
        # comes back in the order the cursor was cut from.
        .order_by(Event.created_at.desc(), Event.id.desc())
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
    """The caller's ``detected`` events awaiting a geolocate, newest first.

    Owner-scoped to ``current_user`` (never the ``{username}`` in any URL): the
    "Detections" queue behind ``/profile/{username}/detections`` where a
    ``detected`` row becomes ``geolocated`` over time. Returns full
    ``EventRead`` (media + tags) so the queue shows the evidence and names, per
    row, what a detection is still missing with no per-row round-trip. Ordered by
    ``created_at DESC, id DESC``: the latest import is the first thing to
    triage.

    ``readiness`` narrows the queue server-side to the detections that clear the
    publish floor (``ready``) or to those that don't (``incomplete``), ``all``
    being the whole queue; anything else is a 422, as ``view`` is on
    :func:`list_events`. The floor is :func:`detection_ready_predicate`, the SQL
    projection of the one ``services.events._publish_detection`` enforces. Filtering
    here rather than over the loaded page is the point: the queue pages at 10
    rows over imports of several hundred, so a page-local filter answers about
    ten detections while the analyst reads it as an answer about the queue.

    ``total`` counts the filtered set, so the page arithmetic describes what is
    being walked; ``ready_total`` and ``incomplete_total`` always count the
    whole queue, so the two numbers are readable at a glance under any
    ``readiness`` and without paging.

    Walked with the ``page`` / ``per_page`` offset pager the queue renders,
    capped at 100 rows per page.
    """
    if readiness not in DETECTION_READINESS:
        raise HTTPException(
            status_code=422,
            detail=f"readiness must be one of: {', '.join(sorted(DETECTION_READINESS))}",
        )
    # A too-large page size is clamped (over-asking buys nothing, it isn't an
    # error); below-1 values are 422 at the ``Query(ge=1)`` gate rather than a
    # negative OFFSET / non-positive LIMIT, which Postgres answers with a 500.
    per_page = page_size(per_page)

    detected = (
        Event.owner_id == current_user.id,
        Event.status == STATUS_DETECTED,
        *visible_events(),
    )
    ready = detection_ready_predicate()

    # Both counts in one pass with ``FILTER``, rather than a count per branch:
    # the payload carries them whatever ``readiness`` asks for, and the filtered
    # total is one of the two (or their sum) rather than a third query.
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
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
            ST_Y(Event.capture_source_coords).label("capture_lat"),
            ST_X(Event.capture_source_coords).label("capture_lng"),
        )
        # The loader rule for every paged event query (this one, the user
        # geolocations page, the follow timeline): ``selectinload`` for the
        # many-to-many / one-to-many sets, because a ``joinedload`` would
        # row-multiply against ``LIMIT`` and silently truncate the page.
        # ``joinedload`` is safe only for the many-to-one owner / requested_by
        # (no inflation; here always NULL on a detection, loaded to skip a
        # lazy hit).
        .options(
            joinedload(Event.owner),
            joinedload(Event.requested_by),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
            selectinload(Event.geolocators).joinedload(EventGeolocator.user),
            selectinload(Event.archives),
            selectinload(Event.source_links),
        )
        .filter(*page_filters)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    items = [
        build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)
        for geo, lat, lng, capture_lat, capture_lng in window.all()
    ]

    return PaginatedEventDetails(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        ready_total=ready_total,
        incomplete_total=incomplete_total,
    )
