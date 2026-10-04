"""Audit-log writes for auth-relevant events, plus the shared rate-limit key.

`log_auth_event` inserts one row inside a SAVEPOINT and swallows its own exceptions: a logging
blind spot beats a login outage. Without the SAVEPOINT, a failed INSERT leaves psycopg in an
error state and the caller's next ``db.commit()`` raises ``PendingRollbackError``.

No IP or User-Agent is stored (privacy). Client-IP extraction survives solely as the
rate-limiter's bucketing key and never reaches a table.
"""

from __future__ import annotations

import ipaddress
import logging
import uuid

from fastapi import Request
from sqlalchemy.orm import Session

from app.config import settings
from app.models.auth_event import AuthEvent

logger = logging.getLogger(__name__)


# CodeQL raises py/clear-text-logging-sensitive-data on the logger call below:
# known false positive (only an event-name constant and a UUID are logged). See
# docs/engineering.md, Particularities, before chasing or "fixing" it.
def log_auth_event(
    db: Session,
    *,
    event: str,
    user_id: uuid.UUID | None = None,
) -> None:
    """Insert one audit row inside a savepoint. Best-effort: never raises. Caller commits."""
    try:
        with db.begin_nested():
            db.add(AuthEvent(user_id=user_id, event=event))
    except Exception as exc:  # noqa: BLE001 — see module docstring.
        logger.warning("auth_event log failed: event=%s user_id=%s err=%s", event, user_id, exc)


def rate_limit_key(request: Request) -> str:
    """Per-IP rate-limit key for ``slowapi.Limiter``.

    ``request.client.host`` (slowapi's default) comes from the left-most ``X-Forwarded-For``
    entry under uvicorn's always-trust mode. Railway's edge *appends* to that header, so the
    left-most entry is attacker-controlled: a random value mints a fresh bucket per request,
    and a victim's IP locks the victim out. :func:`_client_ip` reads the right-most entry
    instead; never read ``request.client.host`` directly.

    With no XFF and no client peer, return a stable sentinel that can't collide with an IP, so
    those requests share one bucket instead of crashing the limiter.
    """
    ip = _client_ip(request)
    return ip if ip is not None else "rate-limit:no-client"


def _client_ip(request: Request) -> str | None:
    """Pick the most accurate client IP available, validated.

    Take the RIGHT-most ``X-Forwarded-For`` entry: trusted proxies *append* the observed client
    IP, so it is the only value we can defend. A client can prepend anything.

    Defaults to ONE trusted hop (Railway to backend). Bump ``TRUSTED_PROXY_HOPS`` to 2 when a
    second trusted proxy (e.g. Cloudflare) lands in front. The value only buckets the rate
    limiter, so a miscount blurs a bucket boundary and is no vulnerability.

    Validated via ``ipaddress.ip_address`` so a hostile non-IP header value falls through to
    the next candidate instead of minting attacker-chosen bucket keys.
    """
    candidates: list[str] = []
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        entries = [e.strip() for e in forwarded.split(",") if e.strip()]
        if entries:
            # Position ``-N`` (N == trusted hops) is what the first trusted proxy saw. A chain
            # shorter than N clamps to the left-most: a blurred bucket beats dropping the value.
            hops = max(1, settings.trusted_proxy_hops)
            index = max(-len(entries), -hops)
            candidates.append(entries[index])
    # No proxy header (local dev, direct hit): ``request.client.host`` is the real client.
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    if host:
        candidates.append(host)

    for candidate in candidates:
        try:
            return str(ipaddress.ip_address(candidate))
        except (ValueError, TypeError):
            continue
    return None
