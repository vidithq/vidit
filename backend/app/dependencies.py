import logging
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import decode_session_token
from app.services.auth_cookies import SESSION_COOKIE

logger = logging.getLogger(__name__)

# How stale ``users.last_seen_at`` may get before an authenticated request
# rewrites it. Every request would otherwise cost an UPDATE plus a commit on the
# hot path; the admin onboarding table reads the value to the day, so a window
# this wide costs the reader nothing.
LAST_SEEN_THROTTLE = timedelta(minutes=15)


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _touch_last_seen(db: Session, user: User) -> None:
    """Stamp ``users.last_seen_at``, at most once per ``LAST_SEEN_THROTTLE``.

    Best-effort, and never raises: a failed activity stamp is a blind spot in
    the onboarding table, while a raised exception here would 500 a request the
    caller was entitled to make. Same discipline as
    ``services/audit.log_auth_event``, with a rollback instead of a savepoint
    because this runs before the route body opens a transaction of its own.
    """
    now = datetime.now(UTC)
    seen = user.last_seen_at
    if seen is not None and now - seen < LAST_SEEN_THROTTLE:
        return
    try:
        user.last_seen_at = now
        db.commit()
    except Exception as exc:  # noqa: BLE001 (see the docstring)
        logger.warning("last_seen touch failed: user_id=%s err=%s", user.id, exc)
        db.rollback()


def get_current_user(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    if not session_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    # One opaque 401 for every decode failure (bad signature, expired,
    # malformed, claim mismatch), which ``decode_session_token`` collapses into
    # ``None``: granular errors would help an attacker probe whether a leaked
    # token is live.
    payload = decode_session_token(session_cookie)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    token_version = payload.get("tv")
    if not isinstance(user_id, str) or not isinstance(token_version, int):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    # Reject soft-deleted accounts like deactivated ones: a deleted user
    # holding a valid JWT loses access at the next request, not the next
    # token rotation.
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Session-lifecycle check: a JWT minted before the user's last invalidation
    # event (logout / password change / reset / soft-delete) carries a stale
    # ``tv`` claim. Opaque 401 like every other decode failure so a probe can't
    # tell "expired" from "invalidated" from "tampered".
    if token_version != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Every check passed, so this request is the account's activity. Stamped
    # here rather than at login: a session lasts ``jwt_expire_minutes`` and
    # register-confirm opens one without a login row, so login alone reports an
    # analyst who signs in once and works for a week as inactive.
    _touch_last_seen(db, user)
    return user


def get_current_user_optional(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User | None:
    """Like get_current_user but returns None instead of raising when unauthenticated.

    For public read endpoints that personalize when a viewer is logged in
    (e.g. profile pages exposing `is_following`).
    """
    try:
        return get_current_user(db, session_cookie)
    except HTTPException:
        return None


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Authorize admin-only routes.

    Built on ``get_current_user`` (which rejects inactive accounts), so a
    deactivated admin loses access the moment ``is_active`` flips to False.
    Returns 403 (not 404) for non-admins with a valid session: the route
    exists, they're just not allowed. The frontend uses ``GET /admin/me`` to
    learn this without leaking ``is_admin`` into the public ``UserRead``.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
