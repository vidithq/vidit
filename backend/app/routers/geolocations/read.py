"""Read endpoints — list, the compact ``/points`` payload, and the filter / bbox / cache-key helpers behind them."""

import hashlib
from datetime import date, timedelta

import orjson
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
)
from fastapi.responses import Response
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import and_
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload, selectinload, subqueryload

from app.cache import points_cache
from app.dependencies import get_current_user, get_db
from app.models.geolocation import STATE_DETECTED, Geolocation
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import limiter
from app.routers.geolocations._common import build_geolocation_read
from app.schemas.geolocation import (
    GeolocationList,
    PaginatedGeolocationDetails,
)

router = APIRouter()
# Reject LIKE-injection at the input boundary — the value flows into
# `User.username.ilike(f"%{author}%")` in `_apply_filters`. Restricting to
# characters real usernames carry kills `%` / `\` vectors before the SQL builder.
_AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"
# Accepted ``media`` filter values (the ``Media.media_type`` domain). Reject
# anything else at the boundary so a typo returns 422 instead of silently
# matching nothing — parameterized, so never an injection risk.
_MEDIA_TYPES = frozenset({"image", "video"})


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


def _parse_filter_date(value: str | None, field: str) -> date | None:
    """Validate an ISO-8601 date filter param. Returns 422 on garbage.

    Forwarding the raw string into the SQLAlchemy comparison let Postgres
    raise ``InvalidDatetimeFormat`` as a 500; once ``/points`` is
    anonymous-reachable a scraper could fill Sentry with those. Matches
    the ``_parse_bbox`` pattern.

    Tolerates full ISO-8601 datetimes (a saved URL or older client may
    send ``2026-05-01T12:00:00Z``). The time component is stripped — this
    is a date filter — but accepting it avoids regressing working URLs
    into a 422 just because the doc shape tightened to ``YYYY-MM-DD``.
    """
    if value is None or value == "":
        return None
    try:
        # 3.11+ ``date.fromisoformat`` accepts a trailing time component;
        # the [:10] truncation is belt-and-braces against older Pythons
        # and makes the date-only intent explicit.
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be an ISO-8601 date (YYYY-MM-DD)",
        ) from exc


def _apply_filters(
    query: SAQuery,
    *,
    conflict: list[str] | None = None,
    capture_source: list[str] | None = None,
    tag: list[str] | None = None,
    event_date_from: str | None = None,
    event_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = None,
    media: list[str] | None = None,
    trusted_only: bool = False,
    hide_demo: bool = False,
    bbox: str | None = None,
) -> SAQuery:
    """Apply the standard geolocation filter set to a query.

    Shared by `/geolocations` and `/geolocations/points` so the two can't
    drift. The soft-delete filter lives here so every public read excludes
    `deleted_at IS NOT NULL` rows; the admin path bypasses this helper.

    Tag semantics: ``conflict``, ``capture_source`` and ``tag`` each take a
    list of names. Within a list, **any-match (OR)**; across the lists,
    **all-match (AND)**. ``conflict`` / ``capture_source`` also pin the
    matched tag's category to their own bucket so a same-named free tag
    can't poison either curated filter; ``tag`` matches any category so a
    caller can filter by a name without knowing its bucket (back-compat
    with the pre-multi-select API).
    """
    query = query.filter(Geolocation.deleted_at.is_(None))

    if conflict:
        # ``.tags.any(...)`` lowers to EXISTS so a second tag filter
        # doesn't row-multiply the way a plain JOIN would.
        query = query.filter(
            Geolocation.tags.any(and_(Tag.name.in_(conflict), Tag.category == "conflict"))
        )
    if capture_source:
        query = query.filter(
            Geolocation.tags.any(
                and_(Tag.name.in_(capture_source), Tag.category == "capture_source")
            )
        )
    if tag:
        query = query.filter(Geolocation.tags.any(Tag.name.in_(tag)))

    # Parse dates up front so a typo returns a clean 422 instead of
    # cascading into Postgres' ``InvalidDatetimeFormat`` as a 500.
    parsed_event_from = _parse_filter_date(event_date_from, "event_date_from")
    parsed_event_to = _parse_filter_date(event_date_to, "event_date_to")
    parsed_submitted_from = _parse_filter_date(submitted_from, "submitted_from")
    parsed_submitted_to = _parse_filter_date(submitted_to, "submitted_to")

    if parsed_event_from:
        query = query.filter(Geolocation.event_date >= parsed_event_from)
    if parsed_event_to:
        query = query.filter(Geolocation.event_date <= parsed_event_to)

    if parsed_submitted_from:
        query = query.filter(Geolocation.created_at >= parsed_submitted_from)
    if parsed_submitted_to:
        # End-of-day inclusive: +1 day with ``<`` (open right interval)
        # is safer than a midnight time string, which would drift around
        # DST boundaries under tz-aware comparison.
        query = query.filter(Geolocation.created_at < parsed_submitted_to + timedelta(days=1))

    if author:
        query = query.join(Geolocation.author).filter(User.username.ilike(f"%{author}%"))

    if media:
        # ``.media.any(...)`` → EXISTS, so a geo with several attachments isn't
        # row-multiplied. Values are ``Media.media_type`` (image / video).
        query = query.filter(Geolocation.media.any(Media.media_type.in_(media)))
    if trusted_only:
        # ``.author.has(...)`` → EXISTS on the FK, so it can't collide with the
        # ``author`` ilike join above.
        query = query.filter(Geolocation.author.has(User.is_trusted.is_(True)))
    if hide_demo:
        query = query.filter(Geolocation.is_demo.is_(False))

    if bbox:
        south, west, north, east = _parse_bbox(bbox)
        query = query.filter(
            ST_Within(
                Geolocation.location,
                ST_MakeEnvelope(west, south, east, north, 4326),
            )
        )

    return query


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """Parse ``south,west,north,east`` into validated floats.

    Raises ``HTTPException(422)`` on malformed input. The previous version
    swallowed parse errors and fell back to an unfiltered query — wrong for
    a map endpoint, where a typo then returned every point on Earth. Empty
    is the right fail-safe; unbounded is not.

    Validation: four comma-separated floats, lat in [-90, 90], lng in
    [-180, 180], south <= north, west <= east. Antimeridian-crossing boxes
    (west > east) aren't handled — MapLibre viewports never produce them.
    """
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=422,
            detail="bbox must be four comma-separated numbers: south,west,north,east",
        )
    try:
        south, west, north, east = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="bbox must be four comma-separated numbers: south,west,north,east",
        ) from exc
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise HTTPException(status_code=422, detail="bbox latitudes must be in [-90, 90]")
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise HTTPException(status_code=422, detail="bbox longitudes must be in [-180, 180]")
    if south > north:
        raise HTTPException(status_code=422, detail="bbox south must be <= north")
    if west > east:
        raise HTTPException(status_code=422, detail="bbox west must be <= east")
    return south, west, north, east


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
    author: str | None = Query(None, pattern=_AUTHOR_FILTER_PATTERN),
    # ``media`` accepts multiple values (``?media=image&media=video``); a geo
    # matches if it has any attachment of a listed type.
    media: list[str] | None = Query(None),
    trusted_only: bool = False,
    hide_demo: bool = False,
    db: Session = Depends(get_db),
):
    """Return all geolocations as a compact array:
    ``[[id, lat, lng, event_date, added_date, detected], ...]``.
    No joins, no limit, designed for map display with client-side clustering.
    ``event_date`` and ``added_date`` (the ``created_at`` calendar day) are
    ISO ``YYYY-MM-DD`` strings; the frontend buckets them for the two timeline
    scrubbers and filters the windows client-side (no refetch per drag).
    ``detected`` is ``1`` for a machine detection (rendered marked), ``0`` for a
    submitted row, a flag, not the state string, to keep the payload small.
    Cached in-memory for 60s per unique filter combination.
    """
    if media and not set(media) <= _MEDIA_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"media must be one of: {', '.join(sorted(_MEDIA_TYPES))}",
        )
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
        Geolocation.id,
        ST_Y(Geolocation.location).label("lat"),
        ST_X(Geolocation.location).label("lng"),
        Geolocation.event_date,
        Geolocation.created_at,
        Geolocation.state,
    )
    q = _apply_filters(
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

    rows = q.all()
    # Compact 6-tuple: [id, lat, lng, event_date, added_date, detected].
    # ``detected`` is 1/0 (not the state string) so the no-LIMIT catalog payload
    # stays small; the map colours the marker off this flag.
    result = [
        [
            str(r.id),
            float(r.lat),
            float(r.lng),
            r.event_date.isoformat(),
            r.created_at.date().isoformat(),
            1 if r.state == STATE_DETECTED else 0,
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


@router.get("", response_model=list[GeolocationList])
@limiter.limit("120/minute")
def list_geolocations(
    request: Request,
    conflict: list[str] | None = Query(None),
    capture_source: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    bbox: str | None = None,
    event_date_from: str | None = None,
    event_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(None, pattern=_AUTHOR_FILTER_PATTERN),
    limit: int = 200,
    db: Session = Depends(get_db),
):
    # Step 1: get IDs with limit (no joins that inflate rows)
    id_query = _apply_filters(
        db.query(Geolocation.id),
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

    ids = [row[0] for row in id_query.order_by(Geolocation.created_at.desc()).limit(limit).all()]

    if not ids:
        return []

    # Step 2: load full objects + coordinates in one query
    rows = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        .options(subqueryload(Geolocation.author), subqueryload(Geolocation.tags))
        .filter(Geolocation.id.in_(ids))
        .order_by(Geolocation.created_at.desc())
        .all()
    )

    return [
        GeolocationList(
            id=geo.id,
            title=geo.title,
            lat=lat,
            lng=lng,
            event_date=geo.event_date,
            is_demo=geo.is_demo,
            state=geo.state,
            author=geo.author,
            tags=geo.tags,
        )
        for geo, lat, lng in rows
    ]


@router.get("/detections", response_model=PaginatedGeolocationDetails)
@limiter.limit("120/minute")
def list_detections(
    request: Request,
    page: int = 1,
    per_page: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's ``detected`` geolocations awaiting submission, newest first.

    Owner-scoped to ``current_user`` (never the ``{username}`` in any URL): the
    "Detections" queue behind ``/profile/{username}/detections`` where a
    ``detected`` row becomes ``submitted`` over time. Returns full
    ``GeolocationRead`` (media + tags) so the queue shows the evidence and the
    frontend computes submit-readiness (>=1 media + a ``conflict`` + a
    ``capture_source`` tag) with no per-row round-trip. A ``detected`` row never
    originates from a bounty (fulfilments are born ``submitted``), so
    ``originated_from_bounty`` is always null here, passed as such to skip the
    join. Ordered by ``created_at`` desc: the latest import is the first thing to
    triage.
    """
    # Clamp rather than 422 — a too-large page/per_page is harmless and the
    # per-user list clamps the same way. The lower-bound guard matters: page < 1
    # would compute a negative OFFSET and per_page < 1 a non-positive LIMIT, both
    # of which Postgres rejects (a 500).
    page = max(1, page)
    per_page = max(1, min(per_page, 100))

    detected = (
        Geolocation.author_id == current_user.id,
        Geolocation.state == STATE_DETECTED,
        Geolocation.deleted_at.is_(None),
    )

    total = db.query(Geolocation).filter(*detected).count()

    rows = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        # ``selectinload`` for the many-to-many / one-to-many sets — a
        # ``joinedload`` would row-multiply against ``LIMIT`` and truncate the
        # page; ``joinedload`` is safe only for the many-to-one author.
        .options(
            joinedload(Geolocation.author),
            selectinload(Geolocation.tags),
            selectinload(Geolocation.media),
        )
        .filter(*detected)
        .order_by(Geolocation.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [
        build_geolocation_read(geo, lat=lat, lng=lng, originated_from_bounty=None)
        for geo, lat, lng in rows
    ]

    return PaginatedGeolocationDetails(items=items, total=total, page=page, per_page=per_page)
