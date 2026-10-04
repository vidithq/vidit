from fastapi import Request
from slowapi import Limiter

from app.config import settings
from app.services.audit import rate_limit_key
from app.services.auth import decode_session_token
from app.services.auth_cookies import SESSION_COOKIE

# One limiter for the app: each `@limiter.limit(...)` keys its bucket by
# (endpoint, client IP), and `enabled` governs every limit from one place. No
# `SlowAPIMiddleware`: limits come only from the decorators, caught by the
# `RateLimitExceeded` handler in `main`.
limiter = Limiter(key_func=rate_limit_key, enabled=settings.rate_limit_enabled)


# ── Per-user read quota ────────────────────────────────────────────────────
# The per-IP limits don't bound one account: a scraper rotating IPs gets a
# fresh bucket per address. This limit is one bucket per `User.id` shared by
# the whole read surface, stacked on the per-endpoint IP limits (which keep
# governing anonymous traffic).
AUTHENTICATED_READ_LIMIT = "1000/hour"

# slowapi keys a bucket by (scope, key) and scopes by request path by default,
# giving every URL its own allowance. A named scope pools them into one budget.
# Public because the 429 handler in `main` reads it to tell this hour-long
# lockout from a per-minute throttle.
AUTHENTICATED_READ_SCOPE = "authenticated-read"

# Bucket for requests with no valid session. It never accrues (see
# ``_authenticated_read_cost``); it is a non-empty constant because slowapi
# skips (and logs an error for) an empty key.
_ANONYMOUS_READ_KEY = "authenticated-read:anonymous"

# Request-scoped memo of the decoded id.
_CACHE_ATTR = "_read_quota_user_id"


def _session_user_id(request: Request) -> str | None:
    """The ``User.id`` the session cookie claims, or ``None``.

    Signature-verified (a forged ``sub`` can't mint a bucket) and answered from
    the JWT alone (no query). Liveness is not re-checked: ``get_current_user``
    owns that, and a bucket key only has to be stable and unforgeable. Cached on
    ``request.state`` for the key and cost functions.
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

    slowapi calls ``exempt_when`` with no request, so ``cost`` is the
    request-aware hook: a cost-0 hit leaves the bucket untouched, excusing
    anonymous traffic from the quota while keeping its per-IP limits.
    """
    return 1 if _session_user_id(request) is not None else 0


# Stack this ABOVE the endpoint's own `@limiter.limit(...)`, never below.
# slowapi evaluates limits in registration order (bottom decorator first) and
# stops at the first failure. With the quota underneath, a request the per-IP
# limit is about to reject has already charged the account's hourly budget;
# above, per-endpoint rejections cost the account nothing.
authenticated_read_quota = limiter.shared_limit(
    AUTHENTICATED_READ_LIMIT,
    scope=AUTHENTICATED_READ_SCOPE,
    key_func=authenticated_read_key,
    cost=_authenticated_read_cost,
)
