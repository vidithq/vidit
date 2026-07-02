"""``GET /possible-duplicates`` — the submit-form duplicate probe (host + proximity legs)."""

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
from sqlalchemy.orm import Session, joinedload

from app.dependencies import get_current_user, get_db
from app.models.event import Event
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.event import (
    PossibleDuplicateRead,
)

router = APIRouter()

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
    geo_geog = cast(Event.location, Geography)
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
        match_clauses.append(Event.source_url.ilike(f"%{host}%"))
    if parsed_date is not None:
        match_clauses.append(Event.event_date == parsed_date)

    # ``match_clauses`` is non-empty by construction — the early-return
    # above (both `host` and `parsed_date` None) keeps `or_(*match_clauses)`
    # from collapsing to SQL ``FALSE``. A refactor dropping that
    # early-return must reintroduce the empty-check here.

    rows = (
        db.query(
            Event,
            ST_Y(Event.location).label("lat"),
            ST_X(Event.location).label("lng"),
            distance_m,
        )
        .options(joinedload(Event.author))
        .filter(Event.deleted_at.is_(None))
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
