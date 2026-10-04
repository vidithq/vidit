import logging
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, HTTPException, status
from psycopg2.errors import LockNotAvailable
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import decode_session_token
from app.services.auth_cookies import SESSION_COOKIE

logger = logging.getLogger(__name__)

# How stale ``users.last_seen_at`` may get before a request rewrites it, so the
# hot path doesn't pay an UPDATE + commit per request.
LAST_SEEN_THROTTLE = timedelta(minutes=15)


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    except OperationalError as exc:
        # A statement outwaited ``database.LOCK_TIMEOUT_MS`` behind another
        # transaction: retryable, not a server fault.
        if not isinstance(exc.orig, LockNotAvailable):
            raise
        logger.warning("Lock wait timed out: %s", exc.orig.diag.context)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "lock_timeout",
                "message": "Another request is changing this record. Try again in a moment.",
            },
        ) from exc
    finally:
        db.close()


def _touch_last_seen(db: Session, user: User) -> None:
    """Stamp ``users.last_seen_at``, at most once per ``LAST_SEEN_THROTTLE``.

    Best-effort and never raises: a failed stamp is a blind spot, while raising
    would 500 a legitimate request. Rolls back instead of using a savepoint (as
    ``services/audit.log_auth_event`` does) because no route transaction is open.
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
    # One opaque 401 for every decode failure so a probe can't tell whether a
    # leaked token is live.
    payload = decode_session_token(session_cookie)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    token_version = payload.get("tv")
    if not isinstance(user_id, str) or not isinstance(token_version, int):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    # Soft-deleted accounts are rejected like deactivated ones, at the next request.
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # A JWT minted before the last invalidation event (logout / password change
    # / reset / soft-delete) has a stale ``tv``; opaque 401 as above.
    if token_version != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Stamped here, not at login: a session lasts ``jwt_expire_minutes`` and
    # register-confirm opens one without a login row.
    _touch_last_seen(db, user)
    return user


def get_current_user_optional(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User | None:
    """Like get_current_user but returns None instead of raising when
    unauthenticated, for public reads that personalize (e.g. `is_following`)."""
    try:
        return get_current_user(db, session_cookie)
    except HTTPException:
        return None


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Authorize admin-only routes.

    Built on ``get_current_user``, so a deactivated admin loses access at once.
    Returns 403 (not 404) for non-admins: the route exists. The frontend learns
    this via ``GET /admin/me``.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
