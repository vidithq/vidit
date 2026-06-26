"""X (Twitter) OAuth 2.0 — Authorization Code + PKCE, confidential client.

Pure protocol: build the authorize redirect, exchange the code for an access
token, read the handle from ``/2/users/me``. No DB, no session — the router
(:mod:`app.routers.auth_x`) owns persistence and **discards the token** after
reading the handle. Hand-rolled over httpx (no ``authlib`` dependency) and
httpx-injectable for ``MockTransport`` tests, mirroring
:func:`app.services.tweet_ingest.syndication.fetch_syndication`.

Scope note: the work-tracker row says ``users.read`` only, but X's
``/2/users/me`` is gated behind ``tweet.read`` *in addition to* ``users.read``,
so we request both. We never read a tweet, and we never request
``offline.access`` — so X issues **no refresh token**. The access token is read
once for the handle and discarded.

This module also signs/verifies the two short-lived JWT cookies the pre-user
round-trip needs (the PKCE state and the verified-handle for register-with-X):
``app.services.auth_tokens`` can't be reused — it keys on a NOT-NULL
``user_id`` FK, but this round-trip happens before any user exists.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.config import settings

# X forces ``tweet.read`` alongside ``users.read`` for ``/2/users/me``; no
# ``offline.access`` → no refresh token. See the module docstring.
X_SCOPES = "tweet.read users.read"
_HTTP_TIMEOUT_S = 10.0
_COOKIE_TTL_SECONDS = 600  # 10 min — generous for a human consent round-trip.


class XOAuthError(Exception):
    """An X OAuth protocol failure carrying a stable ``code`` for the router."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


# ── PKCE + authorize URL ──────────────────────────────────────────────────


def generate_pkce_pair() -> tuple[str, str]:
    """Return ``(code_verifier, code_challenge)`` for the S256 PKCE flow.

    The verifier is a high-entropy secret kept server-side (in the signed state
    cookie); the challenge — ``base64url(sha256(verifier))`` without padding —
    travels in the authorize URL. RFC 7636.
    """
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def build_authorize_url(*, state: str, code_challenge: str) -> str:
    """The X consent URL to redirect the browser to."""
    params = {
        "response_type": "code",
        "client_id": settings.x_client_id,
        "redirect_uri": settings.x_redirect_uri,
        "scope": X_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{settings.x_authorize_url}?{urlencode(params)}"


# ── Token exchange + userinfo ──────────────────────────────────────────────


def exchange_code(*, code: str, code_verifier: str, client: httpx.Client | None = None) -> str:
    """Exchange the authorization ``code`` for an access token.

    Confidential client: HTTP Basic ``client_id:client_secret``. The optional
    ``client`` is a ``MockTransport`` in tests; prod never passes it. Raises
    ``XOAuthError(code="x_oauth_failed")`` on any non-2xx / transport / shape
    failure (the router maps every step's failure to one opaque error so the
    response doesn't reveal which call failed).
    """
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.x_redirect_uri,
        "code_verifier": code_verifier,
    }
    auth = (settings.x_client_id, settings.x_client_secret)
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own:
                resp = own.post(settings.x_token_url, data=data, auth=auth)
        else:
            resp = client.post(settings.x_token_url, data=data, auth=auth)
    except httpx.HTTPError as exc:
        raise XOAuthError(f"token exchange transport error: {exc}", code="x_oauth_failed") from exc

    if resp.status_code >= 300:
        raise XOAuthError(f"token endpoint returned {resp.status_code}", code="x_oauth_failed")
    try:
        body: Any = resp.json()
    except ValueError as exc:
        raise XOAuthError(f"unparseable token response: {exc}", code="x_oauth_failed") from exc
    token = body.get("access_token") if isinstance(body, dict) else None
    if not isinstance(token, str) or not token:
        raise XOAuthError("token response missing access_token", code="x_oauth_failed")
    return token


def fetch_username(*, access_token: str, client: httpx.Client | None = None) -> str:
    """Read the authenticated user's raw handle from ``/2/users/me``.

    Returns the raw ``data.username`` (caller normalizes via
    :func:`app.services.handles.normalize_handle`). Raises
    ``XOAuthError(code="x_oauth_failed")`` on any failure.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own:
                resp = own.get(settings.x_userinfo_url, headers=headers)
        else:
            resp = client.get(settings.x_userinfo_url, headers=headers)
    except httpx.HTTPError as exc:
        raise XOAuthError(f"userinfo transport error: {exc}", code="x_oauth_failed") from exc

    if resp.status_code >= 300:
        raise XOAuthError(f"userinfo returned {resp.status_code}", code="x_oauth_failed")
    try:
        body: Any = resp.json()
    except ValueError as exc:
        raise XOAuthError(f"unparseable userinfo: {exc}", code="x_oauth_failed") from exc
    data = body.get("data") if isinstance(body, dict) else None
    username = data.get("username") if isinstance(data, dict) else None
    if not isinstance(username, str) or not username:
        raise XOAuthError("userinfo missing data.username", code="x_oauth_failed")
    return username


# ── Signed cookies for the pre-user round-trip ─────────────────────────────


def sign_state(*, state: str, code_verifier: str) -> str:
    """JWT the PKCE state + verifier into the short-lived ``vidit_x_oauth`` cookie."""
    payload = {
        "st": state,
        "cv": code_verifier,
        "exp": datetime.now(UTC) + timedelta(seconds=_COOKIE_TTL_SECONDS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_state(token: str) -> tuple[str, str]:
    """Decode the state cookie → ``(state, code_verifier)``.

    Raises ``XOAuthError(code="invalid_state")`` on a tampered / expired /
    malformed cookie.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise XOAuthError("invalid or expired state", code="invalid_state") from exc
    state = payload.get("st")
    code_verifier = payload.get("cv")
    if not isinstance(state, str) or not isinstance(code_verifier, str):
        raise XOAuthError("malformed state payload", code="invalid_state")
    return state, code_verifier


def sign_handle(handle: str) -> str:
    """JWT a verified handle into the short-lived ``vidit_x_register`` cookie."""
    payload = {
        "h": handle,
        "exp": datetime.now(UTC) + timedelta(seconds=_COOKIE_TTL_SECONDS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_handle(token: str) -> str:
    """Decode the verified-handle cookie → the handle.

    Raises ``XOAuthError(code="x_register_expired")`` on a tampered / expired /
    malformed cookie.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise XOAuthError("invalid or expired register handoff", code="x_register_expired") from exc
    handle = payload.get("h")
    if not isinstance(handle, str) or not handle:
        raise XOAuthError("malformed register payload", code="x_register_expired")
    return handle
