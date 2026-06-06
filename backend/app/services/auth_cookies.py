"""Cookie-based session helpers.

The frontend authenticates via two cookies:

- ``vidit_session`` (HTTPOnly): carries the JWT. Not readable from JS, so XSS
  cannot exfiltrate it.
- ``vidit_csrf`` (readable from JS): random token. State-changing requests
  must echo it back via the ``X-CSRF-Token`` header. The browser auto-attaches
  the cookie on cross-origin requests (because we set ``credentials: include``)
  but cannot forge the header from a different origin — that's the CSRF guard.

This is the only authenticated channel into the backend; ``Authorization:
Bearer`` headers are ignored.
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

    The CSRF token is regenerated on every login so a previous session's token
    cannot be replayed after re-auth.
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
    # Browsers match the deletion ``Set-Cookie`` against the original cookie's
    # attributes — in particular ``SameSite=None`` requires ``Secure`` or the
    # header is dropped, which would silently leave the session cookie alive
    # in production. Mirror exactly the attributes used at issuance.
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
