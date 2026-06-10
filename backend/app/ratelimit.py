from slowapi import Limiter

from app.config import settings
from app.services.audit import rate_limit_key

# One limiter for the whole app. Each `@limiter.limit(...)` keys its bucket by
# (endpoint, client IP), so a single shared instance behaves exactly like the
# old per-router ones — but `enabled` now governs every limit from one place,
# so `rate_limit_enabled=false` silences them all. No `SlowAPIMiddleware` is
# registered: limits come only from the explicit decorators and are caught by
# the `RateLimitExceeded` handler in `main`.
limiter = Limiter(key_func=rate_limit_key, enabled=settings.rate_limit_enabled)
