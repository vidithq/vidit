"""Double-submit-cookie CSRF protection.

Only requests that carry the ``vidit_session`` cookie are checked: a request
without the cookie is anonymous (the cookie is the only authenticated channel),
so a CSRF check would have nothing to protect — the downstream auth dependency
will 401 the request anyway when the route is protected.
"""

from __future__ import annotations

import secrets

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp

from app.services.auth_cookies import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SAFE_METHODS,
    SESSION_COOKIE,
)

# Endpoints that issue or replace a session cookie, or are intended to be
# called by a user who *can't* present a valid session/CSRF pair. Exempt
# because (a) there is nothing to forge yet — the attacker has no
# authenticated state to abuse, and (b) requiring CSRF here would lock
# out a user whose session went stale (server restart, secret rotation):
# the browser still holds an HTTPOnly ``vidit_session`` it cannot clear
# from JS, the middleware would see it and demand a token, and the user
# could never log back in.
#
# /forgot-password, /reset-password, /confirm-registration, /resend-
# confirmation follow the same logic: the whole point is that the user
# is locked out / not yet signed in, so any session/CSRF pair on the
# wire is presumed stale. Forcing CSRF on them would turn the recovery
# / registration flow into the very lockout it is meant to resolve.
# They have their own anti-abuse story (per-IP rate limits, single-use
# tokens, no-op-on-unknown-email) that doesn't depend on CSRF.
CSRF_EXEMPT_PATHS = frozenset(
    {
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/confirm-registration",
        "/api/v1/auth/resend-confirmation",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
    }
)


class CSRFMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        if request.method in SAFE_METHODS:
            return await call_next(request)

        if request.url.path in CSRF_EXEMPT_PATHS:
            return await call_next(request)

        # No session cookie → request is anonymous; CSRF n/a. Downstream
        # auth will return 401 if the route is protected.
        if SESSION_COOKIE not in request.cookies:
            return await call_next(request)

        cookie_token = request.cookies.get(CSRF_COOKIE, "")
        header_token = request.headers.get(CSRF_HEADER, "")
        if (
            not cookie_token
            or not header_token
            or not secrets.compare_digest(cookie_token, header_token)
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing or invalid"},
            )

        return await call_next(request)
