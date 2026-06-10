"""Double-submit-cookie CSRF protection.

Only requests carrying the ``vidit_session`` cookie are checked: without it a
request is anonymous (the cookie is the only authenticated channel), so there's
nothing to protect — downstream auth 401s it anyway on protected routes.
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

# Endpoints that issue/replace a session cookie or are called by a user who
# *can't* present a valid session/CSRF pair. Exempt because (a) there's nothing
# to forge yet, and (b) requiring CSRF would lock out a user whose session went
# stale (server restart, secret rotation): the browser still holds an HTTPOnly
# ``vidit_session`` it can't clear from JS, so the middleware would demand a
# token the user can never supply, and they could never log back in.
#
# /forgot-password, /reset-password, /confirm-registration, /resend-
# confirmation follow the same logic — the user is locked out / not yet signed
# in, so any session/CSRF pair on the wire is presumed stale; forcing CSRF
# would turn recovery/registration into the lockout it resolves. They carry
# their own anti-abuse (per-IP rate limits, single-use tokens,
# no-op-on-unknown-email).
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
