"""Audit-log writes for auth-relevant events, plus the shared rate-limit key.

`log_auth_event` inserts one row inside a SAVEPOINT and swallows its own
exceptions: a logging blind spot beats a login outage from a poisoned
transaction. Without the SAVEPOINT, a failed INSERT (FK violation, disk
full) leaves psycopg in an error state and the caller's subsequent
``db.commit()`` raises ``PendingRollbackError``. ``begin_nested()`` rolls
back only the savepoint; the outer transaction stays usable.

No IP or User-Agent is stored (dropped for privacy; network context lives
only at the Cloudflare edge). Client-IP extraction survives below solely as
the rate-limiter's bucketing key: it never reaches a table.
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
    """Insert one audit row inside a savepoint. Best-effort — never raises.

    Caller commits the surrounding transaction. The savepoint is released
    on success and rolled back on failure, so the caller's next flush /
    commit always sees a usable transaction.
    """
    try:
        with db.begin_nested():
            db.add(AuthEvent(user_id=user_id, event=event))
    except Exception as exc:  # noqa: BLE001 — see module docstring.
        logger.warning("auth_event log failed: event=%s user_id=%s err=%s", event, user_id, exc)


def rate_limit_key(request: Request) -> str:
    """Per-IP rate-limit key for ``slowapi.Limiter``.

    ``slowapi``'s default ``get_remote_address`` returns
    ``request.client.host``, which ``uvicorn``'s ``ProxyHeadersMiddleware``
    populates from the **left-most** ``X-Forwarded-For`` entry under
    ``--forwarded-allow-ips=*`` (``always_trust=True`` short-circuits to
    ``x_forwarded_for_hosts[0]``). Railway's edge proxy *appends* to
    ``X-Forwarded-For``, so the left-most entry is attacker-controlled:
    rotating ``X-Forwarded-For: <random>`` mints a fresh bucket per request
    and defeats every per-IP limit; ``X-Forwarded-For: <victim_ip>`` pins
    and locks out a chosen victim.

    :func:`_client_ip` picks the **right-most** entry (what the immediate
    trusted proxy wrote), restoring per-IP semantics. Never read
    ``request.client.host`` directly while uvicorn is in always-trust mode.

    Fallback: with no XFF and no client peer (test-client edge cases),
    return a stable sentinel that can't collide with a parseable IP, so all
    such requests share one bucket rather than crashing the limiter.
    """
    ip = _client_ip(request)
    return ip if ip is not None else "rate-limit:no-client"


def _client_ip(request: Request) -> str | None:
    """Pick the most accurate client IP available, validated.

    Take the RIGHT-most ``X-Forwarded-For`` entry, not the left-most.
    Trusted proxies (Railway, Vercel, Cloudflare) *append* the observed
    client IP, so the chain reads ``client, hop1, ...
    immediate_trusted_proxy_observation``. A malicious client can prepend
    anything, so the left-most entry is attacker-controlled; the right-most
    is what the immediate trusted proxy wrote and the only value we can
    defend.

    Defaults to ONE trusted hop (Railway → backend). When a second trusted
    proxy lands in front (e.g. Cloudflare), bump ``TRUSTED_PROXY_HOPS`` to 2
    to peel the extra append. The value only buckets the rate limiter, so a
    miscount blurs a bucket boundary, no vulnerability.

    Validated via ``ipaddress.ip_address`` so a hostile non-IP header value
    falls through to the next candidate (or the stable sentinel) instead of
    minting attacker-chosen bucket keys.
    """
    candidates: list[str] = []
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        entries = [e.strip() for e in forwarded.split(",") if e.strip()]
        if entries:
            # Position ``-N`` (N == trusted hops) is what the first trusted
            # proxy saw. If the chain is shorter than N (misconfig /
            # single-hop client), clamp to the left-most: a blurred bucket
            # beats dropping the value.
            hops = max(1, settings.trusted_proxy_hops)
            index = max(-len(entries), -hops)
            candidates.append(entries[index])
    # No proxy header (local dev, direct hit): ``request.client.host`` is
    # the real client.
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
