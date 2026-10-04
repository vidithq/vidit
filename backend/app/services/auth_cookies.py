"""Cookie-based session helpers.

The frontend authenticates via two cookies:

- ``vidit_session`` (HTTPOnly): carries the JWT. Not readable from JS, so XSS can't
  exfiltrate it.
- ``vidit_csrf`` (readable from JS): random token. State-changing requests must echo it via the
  ``X-CSRF-Token`` header. The browser auto-attaches the cookie cross-origin
  (``credentials: include``) but can't forge the header from another origin: that is the CSRF
  guard.

These cookies are the only authenticated channel; ``Authorization: Bearer`` headers are ignored.
Mirrored by ``frontend/src/lib/auth.ts`` (and an inlined cookie name in ``proxy.ts``).
"""

from __future__ import annotations

import secrets

from fastapi import Response

from app.config import settings

SESSION_COOKIE = "vidit_session"
CSRF_COOKIE = "vidit_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def issue_session_cookies(response: Response, jwt_token: str) -> str:
    """Set both cookies on ``response`` and return the new CSRF token.

    Regenerated every login so a previous session's token can't be replayed.
    """
    csrf_token = secrets.token_urlsafe(32)
    max_age = settings.jwt_expire_minutes * 60
    domain = settings.cookie_domain or None
    response.set_cookie(
        key=SESSION_COOKIE,
        value=jwt_token,
        max_age=max_age,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=True,
        path="/",
        domain=domain,
    )
    response.set_cookie(
        key=CSRF_COOKIE,
        value=csrf_token,
        max_age=max_age,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=False,
        path="/",
        domain=domain,
    )
    return csrf_token


def clear_session_cookies(response: Response) -> None:
    # Mirror the issuance attributes exactly: browsers match the deletion ``Set-Cookie``
    # against them, and ``SameSite=None`` without ``Secure`` drops the header, silently
    # leaving the session cookie alive in prod.
    domain = settings.cookie_domain or None
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        domain=domain,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=True,
    )
    response.delete_cookie(
        CSRF_COOKIE,
        path="/",
        domain=domain,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=False,
    )
