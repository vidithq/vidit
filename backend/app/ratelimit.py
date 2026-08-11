from fastapi import Request
from slowapi import Limiter

from app.config import settings
from app.services.audit import rate_limit_key
from app.services.auth import decode_session_token
from app.services.auth_cookies import SESSION_COOKIE

# One limiter for the whole app. Each `@limiter.limit(...)` keys its bucket by
# (endpoint, client IP), so a single shared instance behaves exactly like the
# old per-router ones — but `enabled` now governs every limit from one place,
# so `rate_limit_enabled=false` silences them all. No `SlowAPIMiddleware` is
# registered: limits come only from the explicit decorators and are caught by
# the `RateLimitExceeded` handler in `main`.
limiter = Limiter(key_func=rate_limit_key, enabled=settings.rate_limit_enabled)


# ── Per-user read quota ────────────────────────────────────────────────────
# The per-IP limits above bound one client; they don't bound one *account*. A
# logged-in scraper rotating source IPs (a proxy pool, a phone hotspot) gets a
# fresh bucket per address and walks the catalog. This second limit closes
# that: one bucket per `User.id`, shared by the whole read surface, so the
# account is the wall regardless of where the requests come from. It stacks on
# top of the per-endpoint IP limits, which keep governing anonymous traffic.
AUTHENTICATED_READ_LIMIT = "1000/hour"

# slowapi keys a bucket by (scope, key) and defaults the scope to the request
# path, which would hand every URL its own allowance. Naming the scope makes
# every decorated endpoint count into the same bucket, so the quota is a budget
# for reading the catalog rather than a per-URL one. Public because the 429
# handler in `main` reads it off the failed limit to tell this layer's
# hour-long lockout apart from a per-minute throttle.
AUTHENTICATED_READ_SCOPE = "authenticated-read"

# Bucket for requests carrying no valid session. It never accrues (see
# ``_authenticated_read_cost``), so its only job is to be a non-empty constant:
# slowapi skips a limit whose key is empty and logs an error every time it does.
_ANONYMOUS_READ_KEY = "authenticated-read:anonymous"

# Where the decoded id is memoized for the life of one request.
_CACHE_ATTR = "_read_quota_user_id"


def _session_user_id(request: Request) -> str | None:
    """The ``User.id`` the request's session cookie claims, or ``None``.

    Signature-verified, so a forged ``sub`` cannot mint a fresh bucket, and
    answered from the JWT alone, so keying costs no query. Liveness
    (``token_version``, deactivation, soft-delete) is deliberately not
    re-checked: the endpoint's own ``get_current_user`` owns that, and a bucket
    key only has to be stable and unforgeable. Cached on ``request.state``
    because the key and the cost function both need it.
    """
    if not hasattr(request.state, _CACHE_ATTR):
        cookie = request.cookies.get(SESSION_COOKIE)
        payload = decode_session_token(cookie) if cookie else None
        claimed = payload.get("sub") if payload else None
        setattr(request.state, _CACHE_ATTR, claimed if isinstance(claimed, str) else None)
    user_id: str | None = getattr(request.state, _CACHE_ATTR)
    return user_id


def authenticated_read_key(request: Request) -> str:
    """Bucket key for the per-user read quota: the account, never the IP."""
    user_id = _session_user_id(request)
    return f"user:{user_id}" if user_id is not None else _ANONYMOUS_READ_KEY


def _authenticated_read_cost(request: Request) -> int:
    """1 for an authenticated caller, 0 for an anonymous one.

    slowapi calls ``exempt_when`` with no arguments (``wrappers.Limit.
    is_exempt``), so it can't see the request and can't answer "is this caller
    logged in?". ``cost`` is the request-aware hook: a hit of cost 0 leaves the
    bucket untouched, which excuses anonymous traffic from the per-user quota
    while it keeps every per-IP limit it already had.
    """
    return 1 if _session_user_id(request) is not None else 0


# Stack this decorator ABOVE the endpoint's own `@limiter.limit(...)`, never
# below it. slowapi collects both limits against the same handler and evaluates
# them in registration order, consuming a token from each in turn and breaking
# on the first that fails. Decorators apply bottom-up, so the bottom one
# registers first and is evaluated first: with the quota underneath, a request
# the per-IP limit is about to reject has already charged the account's hourly
# budget, and an analyst bursting past a per-minute limit drains an hour of
# reads on requests that returned nothing. Above, the per-endpoint limit
# decides first and its rejections cost the account nothing. A read still
# answers only when the caller is inside both.
authenticated_read_quota = limiter.shared_limit(
    AUTHENTICATED_READ_LIMIT,
    scope=AUTHENTICATED_READ_SCOPE,
    key_func=authenticated_read_key,
    cost=_authenticated_read_cost,
)
