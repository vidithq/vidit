"""``/auth/x/*`` — "Continue with X": one-shot OAuth handle-ownership.

A single entry point that, by whether a profile for the proven handle exists,
does **login + claim + link + register-with-X** over X OAuth 2.0 (Authorization
Code + PKCE). The access token is read once for the handle and **discarded**;
only the verified ``user ↔ handle`` binding persists. The feature is dark unless
configured (``settings.x_oauth_enabled`` → 503).

Layering: the X protocol lives in :mod:`app.services.x_oauth`, the binding
matrix in :mod:`app.services.x_oauth_binding`; this router owns the cookies,
redirects, audit, and commit.

Endpoints (mounted under ``/api/v1/auth/x``):

* ``GET  /start``    — set the signed PKCE-state cookie, redirect to X consent.
* ``GET  /callback`` — validate state, exchange code, read handle, discard
  token, resolve the binding, issue a session (or hand off to register-with-X),
  redirect into the app. Failures redirect to the frontend with ``?x_error=``.
* ``GET  /pending``  — the verified handle for the register-with-X page (404 if
  the handoff cookie is missing/expired).
* ``POST /register`` — create the X-only account from the verified-handle
  cookie + a chosen username, issue a session.
"""

from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_current_user_optional, get_db
from app.models.auth_event import (
    EVENT_LOGIN,
    EVENT_X_LINKED,
    EVENT_X_OAUTH_CLAIM,
    EVENT_X_REGISTERED,
)
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.auth_x import XPendingResponse, XRegisterRequest
from app.schemas.user import UserRead
from app.services import audit, x_oauth, x_oauth_binding
from app.services.auth import create_access_token
from app.services.auth_cookies import issue_session_cookies
from app.services.handles import normalize_handle
from app.services.registration import UsernameAlreadyTakenError

logger = logging.getLogger(__name__)

router = APIRouter()

# Cookies for the pre-user round-trip: short-lived, HttpOnly, scoped to this
# router's path. SameSite/Secure mirror the session cookie so they behave the
# same across the prod cross-site topology (the state cookie must survive the
# top-level redirect back from X; the register cookie is read by same-site XHR).
_STATE_COOKIE = "vidit_x_oauth"
_REGISTER_COOKIE = "vidit_x_register"
_COOKIE_PATH = "/api/v1/auth/x"
_COOKIE_MAX_AGE = 600

# kind → (audit event, redirect path). ``login`` lands on the map; ``claim``
# drops the owner straight onto their review queue; ``link`` on their profile.
_SESSION_REDIRECTS: dict[str, tuple[str, str]] = {
    "claim": (EVENT_X_OAUTH_CLAIM, "/profile/{username}/review"),
    "login": (EVENT_LOGIN, "/map"),
    "link": (EVENT_X_LINKED, "/profile/{username}"),
}


def _require_enabled() -> None:
    if not settings.x_oauth_enabled:
        raise HTTPException(status_code=503, detail="X sign-in is not configured")


def _frontend(path: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}{path}"


def _set_oauth_cookie(resp: Response, name: str, value: str) -> None:
    resp.set_cookie(
        key=name,
        value=value,
        max_age=_COOKIE_MAX_AGE,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=True,
        path=_COOKIE_PATH,
        domain=settings.cookie_domain or None,
    )


def _clear_oauth_cookies(resp: Response) -> None:
    for name in (_STATE_COOKIE, _REGISTER_COOKIE):
        resp.delete_cookie(
            name,
            path=_COOKIE_PATH,
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
            httponly=True,
            domain=settings.cookie_domain or None,
        )


def _error_redirect(code: str, *, to: str = "/login") -> RedirectResponse:
    """Redirect to the frontend with a typed ``?x_error=`` for the banner.

    Always clears the round-trip cookies so a failed attempt can't be retried
    against stale state.
    """
    resp = RedirectResponse(_frontend(f"{to}?{urlencode({'x_error': code})}"), status_code=307)
    _clear_oauth_cookies(resp)
    return resp


@router.get("/start")
@limiter.limit("20/hour")
def x_start(request: Request) -> RedirectResponse:
    """Begin the flow: stash PKCE state in a signed cookie, redirect to X."""
    _require_enabled()
    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = x_oauth.generate_pkce_pair()
    resp = RedirectResponse(
        x_oauth.build_authorize_url(state=state, code_challenge=code_challenge),
        status_code=307,
    )
    _set_oauth_cookie(
        resp, _STATE_COOKIE, x_oauth.sign_state(state=state, code_verifier=code_verifier)
    )
    return resp


@router.get("/callback")
def x_callback(
    request: Request,
    db: Session = Depends(get_db),
    caller: User | None = Depends(get_current_user_optional),
) -> RedirectResponse:
    """Finish the flow: validate, exchange, read the handle, route the binding."""
    _require_enabled()

    if request.query_params.get("error"):
        # User declined consent on X, or X returned an error. Graceful, not a 500.
        return _error_redirect("oauth_refused")

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    state_cookie = request.cookies.get(_STATE_COOKIE)
    if not code or not state or not state_cookie:
        return _error_redirect("invalid_state")
    try:
        expected_state, code_verifier = x_oauth.verify_state(state_cookie)
    except x_oauth.XOAuthError:
        return _error_redirect("invalid_state")
    if not secrets.compare_digest(expected_state, state):
        return _error_redirect("invalid_state")

    try:
        access_token = x_oauth.exchange_code(code=code, code_verifier=code_verifier)
        raw_handle = x_oauth.fetch_username(access_token=access_token)
    except x_oauth.XOAuthError as exc:
        # Log the step that failed (message only — never the token) and return
        # one opaque error so the response doesn't reveal which call failed.
        logger.warning("X OAuth callback failed: %s", exc)
        return _error_redirect("x_oauth_failed")
    handle = normalize_handle(raw_handle)
    # The access token has served its only purpose (proving the handle) and is
    # now out of scope — nothing about it is persisted.

    try:
        outcome = x_oauth_binding.resolve_binding(db, handle=handle, caller=caller)
    except x_oauth_binding.XBindingError as exc:
        db.rollback()
        return _error_redirect(exc.code)

    if outcome.kind == "register":
        # No account for this handle — hand off to register-with-X, carrying the
        # proven handle in a signed cookie (never a spoofable query param).
        resp = RedirectResponse(_frontend("/register?x=1"), status_code=307)
        _clear_oauth_cookies(resp)
        _set_oauth_cookie(resp, _REGISTER_COOKIE, x_oauth.sign_handle(outcome.handle))
        return resp

    assert outcome.user is not None  # claim/login/link always carry a user
    event, path_template = _SESSION_REDIRECTS[outcome.kind]
    audit.log_auth_event_from_request(db, request, event=event, user_id=outcome.user.id)
    db.commit()
    db.refresh(outcome.user)

    resp = RedirectResponse(
        _frontend(path_template.format(username=outcome.user.username)), status_code=307
    )
    _clear_oauth_cookies(resp)
    issue_session_cookies(resp, create_access_token(outcome.user))
    return resp


@router.get("/pending", response_model=XPendingResponse)
def x_pending(request: Request) -> XPendingResponse:
    """Return the verified handle for the register-with-X page to display."""
    _require_enabled()
    cookie = request.cookies.get(_REGISTER_COOKIE)
    if not cookie:
        raise HTTPException(status_code=404, detail="No pending X registration")
    try:
        handle = x_oauth.verify_handle(cookie)
    except x_oauth.XOAuthError as exc:
        raise HTTPException(status_code=404, detail="No pending X registration") from exc
    return XPendingResponse(handle=handle)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
def x_register(
    request: Request,
    response: Response,
    body: XRegisterRequest,
    db: Session = Depends(get_db),
) -> User:
    """Create the X-only account from the verified-handle cookie + username.

    The handle is authoritative from the signed cookie; ``body`` carries only
    the chosen username. Issues a session on success.
    """
    _require_enabled()
    cookie = request.cookies.get(_REGISTER_COOKIE)
    if not cookie:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "x_register_expired",
                "message": "X verification expired. Start again.",
            },
        )
    try:
        handle = x_oauth.verify_handle(cookie)
    except x_oauth.XOAuthError:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "x_register_expired",
                "message": "X verification expired. Start again.",
            },
        ) from None

    try:
        user = x_oauth_binding.create_x_only_account(db, handle=handle, username=body.username)
    except (UsernameAlreadyTakenError, x_oauth_binding.XBindingError) as exc:
        raise_typed_error(exc, {"username_already_taken": 409, "x_handle_conflict": 409})

    audit.log_auth_event_from_request(db, request, event=EVENT_X_REGISTERED, user_id=user.id)
    db.commit()
    db.refresh(user)

    issue_session_cookies(response, create_access_token(user))
    # Burn the one-shot handoff cookie now that the account exists.
    response.delete_cookie(
        _REGISTER_COOKIE,
        path=_COOKIE_PATH,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        httponly=True,
        domain=settings.cookie_domain or None,
    )
    return user
