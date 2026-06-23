import hashlib
import json
import logging
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import NoReturn
from urllib.parse import urlparse

import httpx
import orjson
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import ColumnElement, and_, cast, func, or_
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload, subqueryload

from app.cache import points_cache
from app.config import settings
from app.dependencies import get_current_user, get_db
from app.models.bounty import Bounty
from app.models.geolocation import STATE_DETECTED, Geolocation
from app.models.media import Media
from app.models.proof_image import ProofImage
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.geolocation import (
    GeolocationList,
    GeolocationRead,
    PossibleDuplicateRead,
    TweetImportCoord,
    TweetImportMedia,
    TweetImportQuotedTweet,
    TweetImportRequest,
    TweetImportResponse,
)
from app.schemas.media import MediaUploadResponse
from app.services import geolocations as geolocations_service
from app.services import permissions
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.evidence_processing import EvidenceProcessingError
from app.services.storage import (
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_proof_image,
    validate_file,
)
from app.services.tweet_ingest import (
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    is_trusted_media_url,
    parse_tweet,
)

logger = logging.getLogger(__name__)

router = APIRouter()
# Reject LIKE-injection at the input boundary — the value flows into
# `User.username.ilike(f"%{author}%")` in `_apply_filters`. Restricting to
# characters real usernames carry kills `%` / `\` vectors before the SQL builder.
_AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"
# Accepted ``media`` filter values (the ``Media.media_type`` domain). Reject
# anything else at the boundary so a typo returns 422 instead of silently
# matching nothing — parameterized, so never an injection risk.
_MEDIA_TYPES = frozenset({"image", "video"})


_GEOLOCATION_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "tag_requirements_not_met": 400,
    "bounty_not_found": 404,
    "bounty_not_open": 409,
}


def _raise_geolocation_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed geolocations-service error into an HTTP response.

    Same ``{"code", "message"}`` shape as the registration + admin flows so
    the frontend's error renderer treats every business-rule failure alike.
    """
    raise HTTPException(
        status_code=_GEOLOCATION_ERROR_STATUS.get(exc.code, 400),
        detail={"code": exc.code, "message": str(exc)},
    )


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
    ``[[id, lat, lng, event_date, submitted_date, detected], ...]``.
    No joins, no limit — designed for map display with client-side clustering.
    ``event_date`` and ``submitted_date`` (the ``created_at`` calendar day) are
    ISO ``YYYY-MM-DD`` strings; the frontend buckets them for the two timeline
    scrubbers and filters the windows client-side (no refetch per drag).
    ``detected`` is ``1`` for a machine detection (rendered marked), ``0`` for a
    validated row — a flag, not the state string, to keep the payload small.
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
    # Compact 6-tuple: [id, lat, lng, event_date, submitted_date, detected].
    # ``detected`` is 1/0 (not the state string) so the no-LIMIT catalog payload
    # stays small — the map colours the marker off this flag.
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


# Possible-duplicate probe support — see `list_possible_duplicates`.
#
# Real DNS hostnames are letters / digits / dots / hyphens. Anything else
# is either malformed or a SQL-LIKE meta-character (`%`, `_`, `\`) that
# pollutes the match (`kashmir_news.com` matching `kashmir1news.com` via
# the `_` wildcard) or widens the attack surface. Failing the pattern
# drops the host leg — benign, since "no host match" == "no source URL".
#
# Two structural constraints on top of the character class:
# - Leading char must be alphanumeric. Else ``urlparse('http://./x')
#   .hostname == '.'`` passes and ILIKE-substring-matches every URL with
#   a dot.
# - At least one inner dot. Rejects single-label hosts (`co`, `me`,
#   `localhost`); a two-char host makes the ILIKE leg unbounded (`'%co%'`
#   matches every `.com` / `.co.uk`). Real sources (Twitter, Telegram,
#   etc.) all carry a dot, so this only bites localhost dev — the host
#   leg drops there, the date leg still fires.
_HOST_SAFE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$")

# Hard cap on candidates returned. The submit form renders all of
# them inline; ten is enough to surface real duplicates without
# turning the warning into a wall.
_POSSIBLE_DUPLICATES_LIMIT = 10

# Radius for the proximity leg. A strike footprint is usually <200m but
# witnesses post coords off by a block or two — 500m catches "same event,
# slightly different pin" without inviting "two unrelated events in one village".
_POSSIBLE_DUPLICATES_RADIUS_M = 500.0


def _extract_host(source_url: str) -> str | None:
    """Best-effort host extraction tolerating partial URLs.

    The submit form is mid-typing when this fires, so accept both
    `https://twitter.com/x/status/1` and scheme-stripped `twitter.com/x`.
    Returns the lowercased host minus a leading `www.` (so the substring
    match ignores those cosmetic variants), or ``None`` when the value
    can't parse into a host safe to inject as an ILIKE pattern (see
    ``_HOST_SAFE_PATTERN``).
    """
    parsed = urlparse(source_url)
    host = parsed.hostname
    if host is None:
        # No scheme → urlparse puts the value in ``path``; retry with a
        # stub scheme to coax the host out.
        host = urlparse(f"http://{source_url}").hostname
    if host is None:
        return None
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    if not _HOST_SAFE_PATTERN.match(host):
        return None
    return host


@router.get("/possible-duplicates", response_model=list[PossibleDuplicateRead])
@limiter.limit("60/minute")
def list_possible_duplicates(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    source_url: str | None = Query(None, max_length=2048),
    event_date: str | None = Query(None, max_length=32),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-warning probe used by the submit form.

    Returns geolocations that *might* be the same event as the one being
    submitted. Never blocks the submit — the analyst inspects the list and
    either keeps typing or recognises a row and abandons their version.

    Match rule: within ~500m of the proposed (lat, lng) AND (same source
    host OR same event_date). Both legs are heuristic. Authenticated-only
    so the cheap proximity probe isn't exposed to anonymous scraping
    (sidestepping the bbox-required hardening on /points).

    Tolerates partial / malformed input — a half-typed source URL disables
    the host leg, an unparseable date disables the date leg. If neither is
    usable the response is `[]` (no candidates, no error), so the frontend
    can call this eagerly while the user types.

    No caching — the input space (every coordinate) is unbounded so the hit
    rate is ~0, and a 500ms-debounced probe doesn't need it.
    """
    host: str | None = _extract_host(source_url) if source_url else None

    parsed_date: date | None = None
    if event_date:
        try:
            parsed_date = date.fromisoformat(event_date)
        except ValueError:
            parsed_date = None

    if host is None and parsed_date is None:
        # Neither match leg available → no candidates, and skip a useless
        # trip to PostGIS.
        return []

    # Cast to Geography on the fly so ST_DWithin measures in metres along
    # the geoid, not degrees. The functional cast defeats the GIST index on
    # `location` (geometry), so this seqscans today — fine at current
    # volume. Add a functional index on `(location::geography)` if this
    # shows up in slow-query logs.
    point_geog = cast(
        func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326),
        Geography,
    )
    geo_geog = cast(Geolocation.location, Geography)
    distance_m = func.ST_Distance(geo_geog, point_geog).label("distance_m")

    # Explicit annotation: the host leg appends a ``BinaryExpression``
    # (``ilike``) and the date leg a ``ColumnElement[bool]`` (equality).
    # mypy infers the narrower type from the first ``append`` and rejects
    # the second; widening to the ``ColumnElement[bool]`` supertype fixes it.
    match_clauses: list[ColumnElement[bool]] = []
    if host is not None:
        # ILIKE substring on the stored source URL: Postgres has no URL
        # parser, so matching the host directly would mean a derived
        # column — overkill for a soft warning. The host is already
        # whitelist-validated to LIKE-safe chars in `_extract_host`, so
        # no escape pass is needed.
        match_clauses.append(Geolocation.source_url.ilike(f"%{host}%"))
    if parsed_date is not None:
        match_clauses.append(Geolocation.event_date == parsed_date)

    # ``match_clauses`` is non-empty by construction — the early-return
    # above (both `host` and `parsed_date` None) keeps `or_(*match_clauses)`
    # from collapsing to SQL ``FALSE``. A refactor dropping that
    # early-return must reintroduce the empty-check here.

    rows = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
            distance_m,
        )
        .options(joinedload(Geolocation.author))
        .filter(Geolocation.deleted_at.is_(None))
        .filter(func.ST_DWithin(geo_geog, point_geog, _POSSIBLE_DUPLICATES_RADIUS_M))
        .filter(or_(*match_clauses))
        .order_by(distance_m.asc())
        .limit(_POSSIBLE_DUPLICATES_LIMIT)
        .all()
    )

    return [
        PossibleDuplicateRead(
            id=geo.id,
            title=geo.title,
            lat=row_lat,
            lng=row_lng,
            event_date=geo.event_date,
            source_url=geo.source_url,
            distance_m=float(dist),
            author=geo.author,
        )
        for geo, row_lat, row_lng, dist in rows
    ]


# ── Import-from-tweet ────────────────────────────────────────────────────
#
# Paste a tweet URL, get structured data to pre-fill the submit form
# (title / source / event date / media / best-effort coordinates). The
# analyst always reviews + submits; this route never creates a row.
#
# Sits before `/{geolocation_id}` so the literal path doesn't collide with
# the UUID matcher.


@router.post(
    "/import-from-tweet",
    response_model=TweetImportResponse,
)
@limiter.limit("30/minute")
def import_from_tweet(
    request: Request,
    body: TweetImportRequest,
    current_user: User = Depends(get_current_user),
):
    """Parse a public tweet into a submit-form pre-fill payload.

    Auth-only because (a) the result feeds a write flow only logged-in
    analysts can complete and (b) the syndication endpoint's rate budget is
    finite — an anonymous client shouldn't burn it to scrape X via our
    proxy. Per-IP 30/minute to bound the same risk per logged-in caller.
    """
    try:
        parsed = parse_tweet(body.url)
    except InvalidTweetUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TweetNotAccessible as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TweetFetchFailed as exc:
        # Hide transport / schema-drift detail from the client (the frontend
        # shows a fixed "fill the form manually" banner on 502); log it so
        # the operator can spot a syndication-endpoint outage.
        logger.warning("Tweet syndication fetch failed for %s: %s", body.url, exc)
        raise HTTPException(
            status_code=502, detail="Couldn't read tweet — fill the form manually"
        ) from exc

    quoted = (
        TweetImportQuotedTweet(
            source_url=parsed.quoted_tweet.source_url,
            author_handle=parsed.quoted_tweet.author_handle,
            tweet_text=parsed.quoted_tweet.tweet_text,
        )
        if parsed.quoted_tweet is not None
        else None
    )
    return TweetImportResponse(
        source_url=parsed.source_url,
        original_tweet_url=parsed.original_tweet_url,
        posted_at=parsed.posted_at,
        author_handle=parsed.author_handle,
        tweet_text=parsed.tweet_text,
        suggested_title=parsed.suggested_title,
        parsed_coords=[TweetImportCoord(lat=c.lat, lng=c.lng) for c in parsed.parsed_coords],
        media=[
            TweetImportMedia(
                kind=m.kind,
                remote_url=m.remote_url,
                content_type=m.content_type,
                origin=m.origin,
            )
            for m in parsed.media
        ],
        quoted_tweet=quoted,
    )


# Per-stream byte cap on the media-proxy response. Sized for the upload
# limits (10 MB image / 100 MB video) plus HTTP-framing overhead. Anything
# bigger is an unexpected upstream response or a hostile content-length
# lie; cap and bail so we don't buffer an unbounded stream in memory.
_MEDIA_PROXY_MAX_BYTES = 110 * 1024 * 1024


@router.get("/import-from-tweet/media")
@limiter.limit("60/minute")
def import_from_tweet_media(
    request: Request,
    u: str = Query(..., max_length=2048),
    current_user: User = Depends(get_current_user),
):
    """Stream an X-CDN media URL back to the browser.

    The submit form needs ``File`` objects in ``files[]`` (the contract
    ``services/evidence_processing.py`` keys off), but the X CDN sets no
    CORS headers for a direct browser ``fetch``, so this thin proxy is the
    only path. Strict host whitelist on ``u`` (``pbs.twimg.com`` /
    ``video.twimg.com``) keeps it from becoming an SSRF / open-redirect
    vector; auth-required so it can't be abused as a bandwidth pipe to X.
    """
    if not is_trusted_media_url(u):
        raise HTTPException(status_code=400, detail="URL host not allowed")

    # Stream + abort on cap so a hostile / buggy upstream that lies about
    # ``Content-Length`` (or sends chunked with no length) can't OOM us.
    # The advertised ``Content-Length`` is still pre-checked as a cheap
    # rejection — a declared 5 GB 502s immediately without opening the stream.
    try:
        with httpx.stream(
            "GET",
            u,
            timeout=15.0,
            headers={"User-Agent": "vidit-tweet-import/1.0"},
            follow_redirects=True,
        ) as upstream:
            if upstream.status_code == 404:
                raise HTTPException(status_code=404, detail="Media not found")
            if upstream.status_code >= 300:
                # Log the actual upstream status — an X rate-limit (429)
                # and a 502 look identical client-side but are different
                # debugging stories. Kept out of the response body so a
                # frontend / scraper can't probe.
                logger.warning(
                    "Tweet media proxy got upstream %s for %s",
                    upstream.status_code,
                    u,
                )
                raise HTTPException(status_code=502, detail="Couldn't fetch media")

            advertised = upstream.headers.get("content-length")
            if advertised is not None:
                try:
                    if int(advertised) > _MEDIA_PROXY_MAX_BYTES:
                        raise HTTPException(status_code=502, detail="Media exceeded size cap")
                except ValueError:
                    # Non-numeric Content-Length — fall through to the
                    # streaming check; a malformed header isn't trusted anyway.
                    pass

            content_type = upstream.headers.get("content-type", "application/octet-stream")

            buffer = bytearray()
            for chunk in upstream.iter_bytes():
                buffer.extend(chunk)
                if len(buffer) > _MEDIA_PROXY_MAX_BYTES:
                    # ``with httpx.stream(...)`` closes the connection on
                    # exit so the upstream socket isn't left dangling.
                    raise HTTPException(status_code=502, detail="Media exceeded size cap")
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Tweet media fetch failed for %s: %s", u, exc)
        raise HTTPException(status_code=502, detail="Couldn't fetch media") from exc

    return Response(
        content=bytes(buffer),
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/{geolocation_id}", response_model=GeolocationRead)
@limiter.limit("120/minute")
def get_geolocation(request: Request, geolocation_id: uuid.UUID, db: Session = Depends(get_db)):
    row = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        .options(
            joinedload(Geolocation.author),
            joinedload(Geolocation.media),
            joinedload(Geolocation.tags),
            joinedload(Geolocation.originated_from_bounty).joinedload(Bounty.author),
        )
        .filter(Geolocation.id == geolocation_id, Geolocation.deleted_at.is_(None))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")

    geo, lat, lng = row

    return GeolocationRead(
        id=geo.id,
        title=geo.title,
        lat=lat,
        lng=lng,
        source_url=geo.source_url,
        proof=geo.proof,
        event_date=geo.event_date,
        created_at=geo.created_at,
        updated_at=geo.updated_at,
        is_demo=geo.is_demo,
        state=geo.state,
        detected_from_url=geo.detected_from_url,
        author=geo.author,
        media=geo.media,
        tags=geo.tags,
        originated_from_bounty=geo.originated_from_bounty,
    )


@router.post(
    "/proof-images",
    status_code=status.HTTP_201_CREATED,
    response_model=MediaUploadResponse,
)
@limiter.limit("30/minute")
async def upload_proof_image_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload an inline image referenced from the proof Tiptap document.

    Inserts a `proof_images` row with `geolocation_id=NULL` so the upload
    is tracked before the form is submitted. It's linked to a geolocation
    when `POST /geolocations` runs and the URL survives sanitization; if
    the form is abandoned the row stays orphan and is reaped via the admin
    Maintenance panel (`services/maintenance.py::reap_proof_image_orphans`).

    Rate-limited at two layers: 30/minute per IP (slowapi) and a per-user
    rolling-24h DB ceiling, so one account can't fill the bucket via IP
    rotation.
    """
    # Route through the shared validator so the content-type allow-list +
    # size cap drift in one place. ``validate_file`` accepts image and
    # video; this endpoint is image-only by contract (proof body never
    # embeds video), so the video branch is rejected explicitly below.
    try:
        media_type = validate_file(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if media_type != "image":
        raise HTTPException(
            status_code=400,
            detail=f"File type {file.content_type} not allowed (image required)",
        )

    # Per-user rolling-24h ceiling. Cheap via ix_proof_images_user_id.
    # TOCTOU: two concurrent uploads can both pass this check and briefly
    # exceed the cap by a small constant. Acceptable — the cap is a soft
    # backstop, not exact-quota enforcement, and the 30/min IP limit
    # bounds practical abuse alongside it.
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    recent = (
        db.query(ProofImage)
        .filter(
            ProofImage.user_id == current_user.id,
            ProofImage.created_at >= cutoff,
        )
        .count()
    )
    if recent >= settings.max_proof_images_per_user_per_day:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Per-user upload ceiling reached "
                f"({settings.max_proof_images_per_user_per_day} in 24h). "
                f"Try again later."
            ),
        )

    try:
        result = await upload_proof_image(file, current_user.id)
    except EvidenceProcessingError as exc:
        # Corrupt / truncated image — surface as 400 before we touch the DB.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    url = result.url
    key = get_storage().key_from_url(url)
    # Proof images opt out of derivatives (``produce_derivatives=False`` in
    # ``upload_proof_image``), so ``result.derivative_keys`` is ``()`` here
    # today. The cleanup paths still spread the field so a future flip of
    # the kwarg has the rollback paths already sweeping them. (No assert —
    # asserts strip under ``python -O``, so they're not a safety check.)
    if key is None:
        # Storage returned a URL we can't invert — refuse to ship a row we
        # could never garbage-collect. The just-uploaded object stays
        # orphaned until the reaper's next pass; logging is the only
        # recovery available here.
        logger.error(
            "Proof-image upload landed at unrecognised URL prefix %s; "
            "object orphaned until next reaper pass",
            url,
        )
        raise HTTPException(
            status_code=500,
            detail="Storage returned an unrecognised URL prefix",
        )

    db.add(
        ProofImage(
            s3_key=key,
            user_id=current_user.id,
            sha256=result.sha256,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
            original_filename=safe_original_filename(file.filename),
        )
    )
    try:
        db.commit()
    except Exception:
        # DB unavailable post-upload — without a row the reaper never finds
        # this object. Best-effort delete the original plus derivatives
        # (``()`` today; the spread covers a future ``produce_derivatives``
        # flip without a separate edit).
        db.rollback()
        sweep_keys([key, *result.derivative_keys], context="proof-image upload commit failure")
        raise
    return {"url": url, "sha256": result.sha256}


@router.post("", response_model=GeolocationRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_geolocation(
    request: Request,
    # ``max_length`` ceilings match the DB columns (title String(255),
    # source_url String(2000)) so over-length input is rejected at the
    # boundary, not at flush time AFTER the attached files hit S3.
    title: str = Form(..., min_length=1, max_length=255),
    lat: float = Form(...),
    lng: float = Form(...),
    source_url: str = Form(..., max_length=2000),
    # No ``max_length`` on ``event_date``: ``date.fromisoformat`` is the
    # source of truth (and implicitly bounds length). Capping at 10 would
    # reject a valid ``2026-05-01T00:00:00`` with a generic Pydantic 422
    # instead of our custom message.
    event_date: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    bounty_id: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = files or []

    # ── Parse HTTP-shape inputs. Business rules + IO live in the service.

    # event_date: Form(str) doesn't validate date shape; feeding the raw
    # value into ``Geolocation.event_date`` (Mapped[date]) would 500 at
    # flush, AFTER the S3 round-trips. 422 matches ``_parse_bbox`` /
    # ``_parse_filter_date`` so malformed-input rejections share a code.
    try:
        parsed_event_date = date.fromisoformat(event_date)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="event_date must be an ISO-8601 date (YYYY-MM-DD)",
        ) from exc

    parsed_bounty_id: uuid.UUID | None = None
    if bounty_id:
        try:
            parsed_bounty_id = uuid.UUID(bounty_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bounty_id must be a UUID") from exc

    try:
        proof_data = json.loads(proof) if proof else None
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in 'proof': {exc.msg}") from exc
    if proof_data is not None and not isinstance(proof_data, dict):
        raise HTTPException(status_code=400, detail="'proof' must be a JSON object")

    try:
        parsed_tag_ids = json.loads(tag_ids) if tag_ids else []
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in 'tag_ids': {exc.msg}"
        ) from exc
    if not isinstance(parsed_tag_ids, list):
        raise HTTPException(status_code=400, detail="'tag_ids' must be a JSON array")

    try:
        geo = await geolocations_service.create_with_evidence(
            db,
            current_user=current_user,
            title=title,
            lat=lat,
            lng=lng,
            source_url=source_url,
            event_date=parsed_event_date,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            bounty_id=parsed_bounty_id,
            files=files,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
        )
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)

    # If promoted from a bounty, reload the relationship so the response
    # carries the trace without a separate client fetch. Read-only response
    # assembly — stays in the router.
    originated_from_bounty = None
    if geo.originated_from_bounty_id is not None:
        originated_from_bounty = (
            db.query(Bounty)
            .options(joinedload(Bounty.author))
            .filter(Bounty.id == geo.originated_from_bounty_id)
            .first()
        )

    return GeolocationRead(
        id=geo.id,
        title=geo.title,
        lat=lat,
        lng=lng,
        source_url=geo.source_url,
        proof=geo.proof,
        event_date=geo.event_date,
        created_at=geo.created_at,
        updated_at=geo.updated_at,
        is_demo=geo.is_demo,
        state=geo.state,
        detected_from_url=geo.detected_from_url,
        author=geo.author,
        media=geo.media,
        tags=geo.tags,
        # Pydantic ``from_attributes`` coerces the ``Bounty`` row into the
        # nested schema at runtime; mypy doesn't follow it, so it sees
        # ``Bounty | None`` where the schema declares
        # ``_OriginatedFromBountyNested | None``.
        originated_from_bounty=originated_from_bounty,  # type: ignore[arg-type]
    )


@router.delete("/{geolocation_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Filter out soft-deleted rows: an admin-removed row shouldn't be
    # author-actionable either — same observed behaviour as a genuine 404.
    geo = (
        db.query(Geolocation)
        .filter(Geolocation.id == geolocation_id, Geolocation.deleted_at.is_(None))
        .first()
    )
    if geo is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")
    permissions.ensure_author(geo, current_user)

    # Snapshot inline proof image keys before cascade drops the rows; the
    # S3 objects are deleted after the commit so a failed commit doesn't
    # strand referenced files. Media files are a known parallel orphan
    # problem, not addressed here.
    proof_image_keys = [
        row[0]
        for row in db.query(ProofImage.s3_key).filter(ProofImage.geolocation_id == geo.id).all()
    ]

    db.delete(geo)
    db.commit()

    # On per-key S3 failures (transient outage, key already gone) the rows
    # are already deleted — swallow and log; the next reaper sweep, which
    # cross-references the table, picks the objects up.
    sweep_keys(proof_image_keys, context=f"geolocation {geo.id} delete")

    points_cache.invalidate()
