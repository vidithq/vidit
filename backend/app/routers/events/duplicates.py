"""``GET /possible-duplicates``: the submit-form duplicate probe (host + proximity legs)."""

import re
from datetime import date
from urllib.parse import urlparse

from fastapi import (
    APIRouter,
    Depends,
    Query,
    Request,
)
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import ColumnElement, cast, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import get_current_user, get_db
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.source import Source, SourceLink
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.event import PossibleDuplicateRead
from app.schemas.source import CoordsRead
from app.services.event_filters import visible_events

router = APIRouter()

# See `list_possible_duplicates`.
#
# Real hostnames are letters / digits / dots / hyphens. Anything else is
# malformed or a LIKE meta-character (`%`, `_`, `\`) that pollutes the match
# (`_` matching any char). Failing the pattern drops the host leg.
#
# Two constraints on top of the character class:
# - Leading char alphanumeric, else ``urlparse('http://./x').hostname == '.'``
#   would ILIKE-match every URL with a dot.
# - At least one inner dot, else a short host (`co`) makes the ILIKE leg
#   unbounded. Only bites localhost dev; the date leg still fires.
_HOST_SAFE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$")

# Cap on candidates; enough to surface duplicates without a wall of warnings.
_POSSIBLE_DUPLICATES_LIMIT = 10

# Radius for the proximity leg: witnesses post coords off by a block or two, so
# 500m catches the same event without merging unrelated ones.
_POSSIBLE_DUPLICATES_RADIUS_M = 500.0


def _extract_host(source_url: str) -> str | None:
    """Best-effort host extraction tolerating partial URLs.

    The form is mid-typing, so this accepts scheme-stripped input. Returns the
    lowercased host minus a leading `www.`, or ``None`` when it is not safe to
    inject as an ILIKE pattern (``_HOST_SAFE_PATTERN``).
    """
    parsed = urlparse(source_url)
    host = parsed.hostname
    if host is None:
        # No scheme: urlparse puts the value in ``path``; retry with a stub scheme.
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
@authenticated_read_quota
@limiter.limit("60/minute")
def list_possible_duplicates(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    source_url: str | None = Query(None, max_length=2048),
    occurred_date: str | None = Query(None, max_length=32),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-warning probe used by the submit form.

    Returns geolocations that might be the same event as the one being
    submitted; never blocks the submit.

    Match rule: within ~500m of (lat, lng) AND (a source URL on the same host
    OR same occurred_date). ``source_url`` is one URL the form holds. Coordinate-less rows never match. Authenticated-only so the
    proximity probe isn't exposed to anonymous scraping.

    A half-typed source URL disables the host leg and an unparseable date the
    date leg; with neither usable the response is `[]`, so the frontend can
    call this eagerly.

    Not cached: the input space is unbounded, so the hit rate is ~0.
    """
    host: str | None = _extract_host(source_url) if source_url else None

    parsed_date: date | None = None
    if occurred_date:
        try:
            parsed_date = date.fromisoformat(occurred_date)
        except ValueError:
            parsed_date = None

    if host is None and parsed_date is None:
        # No match leg available: skip the PostGIS trip.
        return []

    # Geography cast so ST_DWithin measures metres, not degrees. It defeats the
    # GIST index on `coords`, so this seqscans; add a functional index on
    # `(coords::geography)` if it shows in slow-query logs.
    point_geog = cast(
        func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326),
        Geography,
    )
    geo_geog = cast(Event.coords, Geography)
    distance_m = func.ST_Distance(geo_geog, point_geog).label("distance_m")

    # Annotated because mypy would infer the narrower type from the first append.
    match_clauses: list[ColumnElement[bool]] = []
    if host is not None:
        # ILIKE substring over every source URL (no URL parser in Postgres). The
        # host is whitelisted to LIKE-safe chars in `_extract_host`.
        match_clauses.append(Event.sources.any(Source.links.any(SourceLink.url.ilike(f"%{host}%"))))
    if parsed_date is not None:
        match_clauses.append(Event.occurred_date == parsed_date)

    # ``match_clauses`` is non-empty because of the early return above, which
    # keeps ``or_`` from collapsing to ``FALSE``; keep that guard.

    rows = (
        db.query(
            Event,
            ST_Y(Event.coords).label("lat"),
            ST_X(Event.coords).label("lng"),
            distance_m,
        )
        .options(joinedload(Event.owner), selectinload(Event.sources).selectinload(Source.links))
        .filter(*visible_events())
        # Located rows only: a request may carry an approximate guess, so
        # proximity alone would surface it; filter on status like
        # ``search._search_events``.
        .filter(Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)))
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
            coords=CoordsRead(lat=row_lat, lng=row_lng),
            occurred_date=geo.occurred_date,
            source_urls=[link.url for source in geo.sources for link in source.links],
            distance_m=float(dist),
            owner=geo.owner,
        )
        for geo, row_lat, row_lng, dist in rows
    ]
