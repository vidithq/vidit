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
from typing import Any

from fastapi import Response

from app.config import settings

SESSION_COOKIE = "vidit_session"
CSRF_COOKIE = "vidit_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_HTTPONLY = {SESSION_COOKIE: True, CSRF_COOKIE: False}


def _attributes(name: str) -> dict[str, Any]:
    """Issuance and deletion share these: browsers match the deletion ``Set-Cookie`` against
    them, and ``SameSite=None`` without ``Secure`` drops the header, silently leaving the session
    cookie alive in prod."""
    return {
        "path": "/",
        "domain": settings.cookie_domain or None,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "httponly": _HTTPONLY[name],
    }


def issue_session_cookies(response: Response, jwt_token: str) -> None:
    # The CSRF token is regenerated every login so a previous session's token can't be replayed.
    values = {SESSION_COOKIE: jwt_token, CSRF_COOKIE: secrets.token_urlsafe(32)}
    for name, value in values.items():
        response.set_cookie(
            key=name, value=value, max_age=settings.jwt_expire_minutes * 60, **_attributes(name)
        )


def clear_session_cookies(response: Response) -> None:
    for name in _HTTPONLY:
        response.delete_cookie(name, **_attributes(name))
