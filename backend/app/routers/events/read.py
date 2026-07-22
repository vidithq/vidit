"""Read endpoints: list (located + requested views), the compact ``/points``
payload, and the filter / bbox / cache-key helpers behind them."""

import hashlib
import uuid

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
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.cache import points_cache
from app.dependencies import get_current_user, get_db
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from app.models.user import User
from app.ratelimit import limiter
from app.routers.events._common import build_event_read, coords_or_none, thumbnail_media
from app.schemas.event import (
    EventList,
    PaginatedEventDetails,
)
from app.schemas.user import AuthorRef
from app.services.event_filters import (
    AUTHOR_FILTER_PATTERN,
    VIEWS,
    apply_filters,
    validate_media_types,
    validate_status_filter,
)
from app.services.thumbnails import thumbnail_media_criteria

router = APIRouter()
# Detail page lists every investigator; the list card only needs a few
# avatars + a count. Tune if the avatar strip grows.
LIST_INVESTIGATOR_SAMPLE_SIZE = 3


def _build_points_cache_key(
    *,
    conflict: list[str] | None,
    capture_source: list[str] | None,
    tag: list[str] | None,
    event_date_from: str | None,
    event_date_to: str | None,
    submitted_from: str | None,
    submitted_to: str | None,
    author: str | None,
    media: list[str] | None = None,
    trusted_only: bool = False,
    hide_demo: bool = False,
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
    """
    payload = orjson.dumps(
        [
            sorted(conflict) if conflict else None,
            sorted(capture_source) if capture_source else None,
            sorted(tag) if tag else None,
            event_date_from,
            event_date_to,
            submitted_from,
            submitted_to,
            author,
            sorted(media) if media else None,
            trusted_only,
            hide_demo,
        ]
    )
    return f"points:{hashlib.sha256(payload).hexdigest()}"


def investigator_aggregates(
    db: Session, event_ids: list[uuid.UUID]
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, list[AuthorRef]]]:
    """Per-event investigator count + newest-first capped sample, without N+1.

    Detail can afford eager-loading every row on its one event; a list runs
    two grouped queries: one for the per-row count, one for the sample.
    A Postgres window function would be tidier for the sample, but joined
    order_by + a Python-side cap is simpler and the working set is small.
    """
    counts: dict[uuid.UUID, int] = {
        eid: int(count)
        for eid, count in db.query(EventInvestigator.event_id, func.count("*"))
        .filter(EventInvestigator.event_id.in_(event_ids))
        .group_by(EventInvestigator.event_id)
        .all()
    }
    sample: dict[uuid.UUID, list[AuthorRef]] = {}
    rows = (
        db.query(EventInvestigator)
        .options(joinedload(EventInvestigator.user))
        .filter(EventInvestigator.event_id.in_(event_ids))
        .order_by(EventInvestigator.event_id, EventInvestigator.created_at.desc())
        .all()
    )
    for row in rows:
        bucket = sample.setdefault(row.event_id, [])
        if len(bucket) < LIST_INVESTIGATOR_SAMPLE_SIZE:
            bucket.append(AuthorRef.model_validate(row.user))
    return counts, sample


@router.get("/points")
@limiter.limit("60/minute")
def list_points(
    request: Request,
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
    trusted_only: bool = False,
    hide_demo: bool = False,
    db: Session = Depends(get_db),
):
    """Return the map's events as a compact array:
    ``[[id, lat, lng, event_date, added_date, detected, demo], ...]``.
    No joins, no limit, designed for map display with client-side clustering.
    Live ``geolocated`` / ``detected`` rows with a subject coordinate only: a
    ``requested`` guess is not a confident pin, and a closed row was judged
    out. ``event_date`` and ``added_date`` (the ``created_at`` calendar day)
    are ISO ``YYYY-MM-DD`` strings; the frontend buckets them for the two
    timeline scrubbers and filters the windows client-side (no refetch per
    drag). ``detected`` is ``1`` for a machine detection (rendered marked),
    ``0`` for a geolocated row; ``demo`` is ``1`` for a demo row (the filter
    panel offers its hide-demo toggle only when one is present). Flags, not
    strings, to keep the payload small. Cached in-memory for 60s per unique
    filter combination.
    """
    validate_media_types(media)
    cache_key = _build_points_cache_key(
        conflict=conflict,
        capture_source=capture_source,
        tag=tag,
        event_date_from=event_date_from,
        event_date_to=event_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
        trusted_only=trusted_only,
        hide_demo=hide_demo,
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
        Event.is_demo,
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
        trusted_only=trusted_only,
        hide_demo=hide_demo,
    )
    # Map-only narrowing on top of the located view: a closed detection stays
    # on the list (audit trail) but comes off the map, and a coordinate is
    # required for a pin at all.
    q = q.filter(
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        Event.event_coords.isnot(None),
    )

    rows = q.all()
    # Compact 7-tuple: [id, lat, lng, event_date, added_date, detected, demo].
    # ``detected`` / ``demo`` are 1/0 flags (not strings) so the no-LIMIT
    # catalog payload stays small; the map colours the marker off ``detected``
    # and the filter panel shows its hide-demo toggle off ``demo``.
    result = [
        [
            str(r.id),
            float(r.lat),
            float(r.lng),
            r.event_date.isoformat(),
            r.created_at.date().isoformat(),
            1 if r.status == STATUS_DETECTED else 0,
            1 if r.is_demo else 0,
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
@limiter.limit("120/minute")
def list_events(
    request: Request,
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
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """Newest-first cards for one lifecycle view.

    ``view=located`` (default) is the catalog; ``view=requested`` the open-call
    queue (ex ``/requests``), whose cards additionally carry the investigator
    aggregates (count + a small newest-first sample). Two-step "ids then full
    rows" shape so eager-loads can't inflate the LIMIT count.
    """
    if view not in VIEWS:
        raise HTTPException(
            status_code=422, detail=f"view must be one of: {', '.join(sorted(VIEWS))}"
        )
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 200")
    validate_status_filter(status)

    # Step 1: get IDs with limit (no joins that inflate rows)
    id_query = apply_filters(
        db.query(Event.id),
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

    ids = [row[0] for row in id_query.order_by(Event.created_at.desc()).limit(limit).all()]

    if not ids:
        return []

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
        .order_by(Event.created_at.desc())
        .all()
    )

    # The requested queue renders "N working" per card, so aggregate once for
    # the page, not per row.
    counts: dict[uuid.UUID, int] = {}
    sample: dict[uuid.UUID, list[AuthorRef]] = {}
    if view == "requested":
        counts, sample = investigator_aggregates(db, ids)

    return [
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
            investigator_count=counts.get(geo.id, 0) if view == "requested" else None,
            investigators_sample=sample.get(geo.id, []) if view == "requested" else None,
        )
        for geo, lat, lng in rows
    ]


@router.get("/detections", response_model=PaginatedEventDetails)
@limiter.limit("120/minute")
def list_detections(
    request: Request,
    page: int = 1,
    per_page: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's ``detected`` events awaiting a geolocate, newest first.

    Owner-scoped to ``current_user`` (never the ``{username}`` in any URL): the
    "Detections" queue behind ``/profile/{username}/detections`` where a
    ``detected`` row becomes ``geolocated`` over time. Returns full
    ``EventRead`` (media + tags) so the queue shows the evidence and the
    frontend computes submit-readiness (source media + a ``conflict`` + a
    ``capture_source`` tag) with no per-row round-trip. Ordered by ``created_at``
    desc: the latest import is the first thing to triage.
    """
    # Clamp rather than 422 — a too-large page/per_page is harmless and the
    # per-user list clamps the same way. The lower-bound guard matters: page < 1
    # would compute a negative OFFSET and per_page < 1 a non-positive LIMIT, both
    # of which Postgres rejects (a 500).
    page = max(1, page)
    per_page = max(1, min(per_page, 100))

    detected = (
        Event.owner_id == current_user.id,
        Event.status == STATUS_DETECTED,
        Event.deleted_at.is_(None),
    )

    total = db.query(Event).filter(*detected).count()

    rows = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
            ST_Y(Event.capture_source_coords).label("capture_lat"),
            ST_X(Event.capture_source_coords).label("capture_lng"),
        )
        # ``selectinload`` for the many-to-many / one-to-many sets — a
        # ``joinedload`` would row-multiply against ``LIMIT`` and truncate the
        # page; ``joinedload`` is safe only for the many-to-one owner /
        # requested_by (always NULL on a detection, loaded to skip a lazy hit).
        .options(
            joinedload(Event.owner),
            joinedload(Event.requested_by),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
            selectinload(Event.geolocators).joinedload(EventGeolocator.user),
            selectinload(Event.investigators).joinedload(EventInvestigator.user),
        )
        .filter(*detected)
        .order_by(Event.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [
        build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)
        for geo, lat, lng, capture_lat, capture_lng in rows
    ]

    return PaginatedEventDetails(items=items, total=total, page=page, per_page=per_page)
