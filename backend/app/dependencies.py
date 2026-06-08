from collections.abc import Generator

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.user import User
from app.services.auth_cookies import SESSION_COOKIE


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    if not session_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(
            session_cookie,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        user_id = payload.get("sub")
        token_version = payload.get("tv")
        if not isinstance(user_id, str) or not isinstance(token_version, int):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except jwt.InvalidTokenError as err:
        # InvalidTokenError is the PyJWT base class for every decode
        # failure (bad signature, expired, malformed, claim mismatch).
        # Same opaque 401 for every failure mode — granular errors
        # would help an attacker probe whether a leaked token is still
        # live.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from err

    user = db.query(User).filter(User.id == user_id).first()
    # Reject deleted accounts the same way as deactivated ones — a
    # soft-deleted user holding a still-valid JWT must lose access at
    # the next request, not the next token rotation.
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Session-lifecycle check: a JWT minted before the user's last
    # invalidation event (logout / password change / reset / soft-
    # delete) carries a stale ``tv`` claim. Opaque 401 — same shape as
    # every other decode failure so a leaked-token probe can't tell
    # "expired" from "invalidated" from "tampered".
    if token_version != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user


def get_current_user_optional(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User | None:
    """Same as get_current_user but returns None instead of raising when unauthenticated.

    Used by public read endpoints that personalize the response when a viewer
    is logged in (e.g. profile pages exposing `is_following`).
    """
    try:
        return get_current_user(db, session_cookie)
    except HTTPException:
        return None


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Authorize admin-only routes.

    Layers on top of ``get_current_user`` (which already rejects inactive
    accounts), so a deactivated admin loses god-mode the moment ``is_active``
    flips to False — no separate ``require_active_user`` indirection needed.
    Returns 403 (not 404) for non-admins with a valid session: the route
    *exists*, they're just not allowed. The frontend uses ``GET /admin/me``
    to learn this without leaking ``is_admin`` into the public ``UserRead``.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
