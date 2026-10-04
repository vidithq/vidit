"""Double-submit-cookie CSRF protection.

Only requests carrying the ``vidit_session`` cookie are checked: without it a
request is anonymous and downstream auth 401s it on protected routes.
"""

from __future__ import annotations

import secrets

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.services.auth_cookies import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SAFE_METHODS,
    SESSION_COOKIE,
)

# Endpoints that issue a session cookie or are called by a user who can't
# present a valid session/CSRF pair. Exempt because there is nothing to forge
# yet, and a stale HTTPOnly ``vidit_session`` (restart, secret rotation) the
# user can't clear from JS would otherwise demand a token they can never
# supply, locking them out of logging back in. Recovery and registration follow
# the same logic and carry their own anti-abuse (per-IP limits, single-use
# tokens, no-op on unknown email).
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
    async def dispatch(self, request: Request, call_next):
        if request.method in SAFE_METHODS:
            return await call_next(request)

        if request.url.path in CSRF_EXEMPT_PATHS:
            return await call_next(request)

        # No session cookie: anonymous, CSRF n/a (downstream auth 401s).
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
