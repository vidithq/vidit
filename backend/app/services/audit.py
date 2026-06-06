"""Audit-log writes for auth-relevant events.

Single entry-point `log_auth_event` called from the auth router on each
event of interest. The helper is intentionally tiny: it inserts one row
inside a SAVEPOINT, and swallows its own exceptions. A failure to log
must never bubble up and break the auth flow itself — a logging-failure
blind spot is bad, but a login outage caused by a poisoned transaction
is worse.

The SAVEPOINT matters: without it, a failed INSERT (FK violation, disk
full, INET-coercion error from a hostile X-Forwarded-For) leaves
psycopg in an error state, and the caller's subsequent ``db.commit()``
raises ``PendingRollbackError``. Wrapping in ``begin_nested()`` means
only the savepoint rolls back; the outer transaction stays usable.

The router is responsible for extracting `ip` and `user_agent` from the
`Request`. We don't reach for `Request` here because parts of the auth
flow (forgot-password background task) run off the request thread and
do not have a live Request handle.
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


def log_auth_event(
    db: Session,
    *,
    event: str,
    user_id: uuid.UUID | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Insert one audit row inside a savepoint. Best-effort — never raises.

    Caller commits the surrounding transaction. The savepoint is
    released on success and rolled back on failure, so the caller's
    next ``db.flush()`` / ``db.commit()`` always sees a usable
    transaction.
    """
    try:
        with db.begin_nested():
            db.add(
                AuthEvent(
                    user_id=user_id,
                    event=event,
                    ip=ip,
                    user_agent=user_agent,
                )
            )
    except Exception as exc:  # noqa: BLE001 — see module docstring.
        logger.warning("auth_event log failed: event=%s user_id=%s err=%s", event, user_id, exc)


def log_auth_event_from_request(
    db: Session,
    request: Request,
    *,
    event: str,
    user_id: uuid.UUID | None = None,
) -> None:
    """Convenience wrapper for request-bound paths.

    Extracts ``ip`` and ``user_agent`` from the ``Request`` and delegates
    to ``log_auth_event``. Use the low-level form from any code path that
    runs off the request thread (e.g. a FastAPI background task with no
    live ``Request`` handle); reach for this wrapper in every auth
    handler to drop the four-line ip/user-agent boilerplate.
    """
    log_auth_event(
        db,
        event=event,
        user_id=user_id,
        ip=extract_client_ip(request),
        user_agent=extract_user_agent(request),
    )


def rate_limit_key(request: Request) -> str:
    """Per-IP rate-limit key for ``slowapi.Limiter``.

    ``slowapi``'s default ``get_remote_address`` returns ``request.client.host``,
    which ``uvicorn``'s ``ProxyHeadersMiddleware`` populates from the
    **left-most** entry of ``X-Forwarded-For`` when launched with
    ``--forwarded-allow-ips=*`` (verified in the live uvicorn source:
    ``always_trust=True`` short-circuits to ``x_forwarded_for_hosts[0]``).
    Railway's edge proxy *appends* to ``X-Forwarded-For`` rather than
    overwriting it, so the left-most entry is whatever the client sent —
    fully attacker-controlled. Rotating ``X-Forwarded-For: <random>`` per
    request mints a fresh bucket every time and defeats every per-IP
    limit (``/login`` 5/min, ``/register`` 10/hr, ``/forgot-password``
    5/hr, the global 60/min); sending ``X-Forwarded-For: <victim_ip>``
    pins a chosen victim's bucket and locks them out.

    The audit-log path already uses :func:`extract_client_ip` to pick the
    **right-most** entry (the one the immediate trusted proxy wrote);
    routing slowapi through the same parser restores per-IP semantics
    and closes the spoof. We never want slowapi keys to read
    ``request.client.host`` directly while uvicorn is in always-trust
    mode.

    Fallback: when no XFF and no client peer are available (extremely
    unusual — test client edge cases), return a stable sentinel so all
    such requests share one bucket rather than crashing the limiter.
    The sentinel intentionally cannot collide with a parseable IP.
    """
    ip = extract_client_ip(request)
    return ip if ip is not None else "rate-limit:no-client"


def extract_client_ip(request: Request) -> str | None:
    """Pick the most accurate client IP available, validated.

    Take the RIGHT-most entry of ``X-Forwarded-For``, not the left-most.
    Trusted proxies (Railway, Vercel, Cloudflare) *append* the observed
    client IP when they forward, so the chain reads ``client, hop1,
    hop2 ... immediate_trusted_proxy_observation``. A malicious client
    can prepend anything to the header — taking the left-most entry
    therefore means trusting attacker-controlled input, which would
    let an attacker freely spoof the audit log. The right-most entry
    is the one the immediate trusted proxy wrote and is the value we
    can actually defend.

    Defaults to ONE trusted hop (Railway → backend, current prod
    topology). When a second trusted proxy lands in front of Railway
    (e.g. Cloudflare), bump ``TRUSTED_PROXY_HOPS`` to 2 so we peel the
    extra append and pick the entry the first trusted proxy actually
    saw. The audit log is forensics, not access control, so a one-off
    miscount only blurs the chosen entry — it doesn't open a
    vulnerability.

    Whatever we pick is fed into a Postgres ``INET`` column, which
    strict-rejects anything that isn't a parseable IPv4 / IPv6, so we
    validate via ``ipaddress.ip_address`` and return None on a bad
    value (the row goes in with ``ip = NULL`` rather than poisoning
    the savepoint).
    """
    candidates: list[str] = []
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        entries = [e.strip() for e in forwarded.split(",") if e.strip()]
        if entries:
            # Pick the Nth-from-the-right entry, where N == trusted hops.
            # Each trusted proxy appends its observation when forwarding,
            # so position ``-N`` is what the *first* trusted proxy saw.
            # If the chain is shorter than N (misconfig or a header sent
            # by a single-hop client), clamp to the left-most entry —
            # better forensics than dropping the value.
            hops = max(1, settings.trusted_proxy_hops)
            index = max(-len(entries), -hops)
            candidates.append(entries[index])
    # Fallback: when no proxy header is present (local dev, direct
    # backend hit) ``request.client.host`` is the real client.
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


def extract_user_agent(request: Request) -> str | None:
    ua = request.headers.get("user-agent")
    # Postgres TEXT is unbounded but absurdly-long UA strings (>2 KB) are
    # almost always garbage from a malformed scraper — cap so one row
    # can't pollute the table.
    if ua and len(ua) > 1024:
        return ua[:1024]
    return ua
