import hashlib
import logging
import uuid
from datetime import UTC, datetime
from typing import NoReturn
from urllib.parse import urlencode

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_current_user, get_db
from app.models.auth_event import (
    EVENT_FAILED_LOGIN,
    EVENT_LOGIN,
    EVENT_LOGOUT,
    EVENT_PASSWORD_CHANGED,
    EVENT_PASSWORD_RESET_COMPLETED,
    EVENT_PASSWORD_RESET_REQUESTED,
    EVENT_REGISTER_CONFIRMED,
    EVENT_REGISTER_PENDING,
    EVENT_REGISTER_RESENT,
)
from app.models.auth_token import PURPOSE_PASSWORD_RESET
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.auth import LoginRequest, RegisterRequest, RegisterResponse
from app.schemas.recovery import (
    ChangePasswordRequest,
    ConfirmRegistrationRequest,
    ForgotPasswordRequest,
    ResendConfirmationRequest,
    ResetPasswordRequest,
)
from app.schemas.user import UserRead
from app.services import audit, auth_tokens, email, registration
from app.services.audit import rate_limit_key
from app.services.auth import (
    DUMMY_PASSWORD_HASH,
    bump_token_version,
    create_access_token,
    decode_session_token_with_reason,
    hash_password,
    maybe_promote_admin,
    verify_password,
)
from app.services.auth_cookies import (
    SESSION_COOKIE,
    clear_session_cookies,
    issue_session_cookies,
)

logger = logging.getLogger(__name__)


router = APIRouter()


def _session_or_ip_key(request: Request) -> str:
    """Rate-limit key for cookie-authenticated endpoints.

    Keys on the hashed session (never the raw JWT) so analysts behind one NAT
    don't collide; falls back to :func:`rate_limit_key` without a cookie.
    """
    cookie = request.cookies.get(SESSION_COOKIE)
    if cookie:
        return f"session:{hashlib.sha256(cookie.encode('utf-8')).hexdigest()[:16]}"
    return rate_limit_key(request)


def _build_link(path: str, token: str) -> str:
    base = settings.frontend_url.rstrip("/")
    return f"{base}{path}?{urlencode({'token': token})}"


def _send_password_changed_notification_best_effort(*, user_id: uuid.UUID, to: str) -> None:
    """Send the change-password heads-up email but never raise.

    The credential is already written, so a Resend outage must not fail the
    rotation. Logs ``user_id`` not the address, to avoid widening where the
    user to address mapping leaks.
    """
    try:
        email.send(email.password_changed_email(to=to))
    except email.EmailSendError as exc:
        logger.warning(
            "password changed notification send failed for user_id=%s: %s",
            user_id,
            exc,
        )


def _send_registration_confirmation_best_effort(*, to: str, raw_token: str) -> None:
    """Send the confirmation email but never raise.

    The pending row already exists; the user can request a resend.
    """
    try:
        link = _build_link("/confirm-registration", raw_token)
        email.send(email.registration_confirmation_email(to=to, link=link))
    except email.EmailSendError as exc:
        logger.warning("registration confirmation email send failed for %s: %s", to, exc)


# ── Registration: pre-creation flow ──────────────────────────────────────

_REGISTRATION_ERROR_STATUS: dict[str, int] = {
    "invalid_invite": 400,
    "email_already_registered": 409,
    "username_already_taken": 409,
    "email_pending_confirmation": 409,
    "username_pending_confirmation": 409,
    "invalid_or_expired_token": 400,
}


def _raise_registration_error(exc: registration.RegistrationError) -> NoReturn:
    raise_typed_error(exc, _REGISTRATION_ERROR_STATUS)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("10/hour")
def register(
    request: Request,
    body: RegisterRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RegisterResponse:
    """Stage a registration. No ``users`` row is created and no cookie is set.

    The account is created at ``POST /auth/confirm-registration``.
    """
    try:
        mint = registration.create_pending_registration(
            db,
            email=body.email,
            username=body.username,
            password=body.password,
            invite_code=body.invite_code,
        )
    except registration.RegistrationError as exc:
        _raise_registration_error(exc)

    audit.log_auth_event(
        db,
        event=EVENT_REGISTER_PENDING,
    )
    db.commit()

    # Sent off-thread like /forgot-password: an inline Resend round-trip would
    # make this branch slower than the already-registered ones and leak state.
    background_tasks.add_task(
        _send_registration_confirmation_best_effort,
        to=mint.email,
        raw_token=mint.raw_token,
    )
    return RegisterResponse(email=mint.email)


@router.post("/confirm-registration", response_model=UserRead)
@limiter.limit("30/hour")
def confirm_registration(
    request: Request,
    response: Response,
    body: ConfirmRegistrationRequest,
    db: Session = Depends(get_db),
) -> User:
    """Consume the confirmation token, create the user, sign them in.

    Re-validates the invite and uniqueness in the same transaction as the user
    insert (the pending row held the address until now).
    """
    try:
        user = registration.confirm_pending_registration(db, body.token)
    except registration.RegistrationError as exc:
        _raise_registration_error(exc)

    # Same stamp as login: this call signs the analyst in without a ``login`` event.
    user.last_seen_at = datetime.now(UTC)
    audit.log_auth_event(
        db,
        event=EVENT_REGISTER_CONFIRMED,
        user_id=user.id,
    )
    db.commit()
    db.refresh(user)

    token = create_access_token(user)
    issue_session_cookies(response, token)
    return user


@router.post("/resend-confirmation", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
def resend_confirmation(
    request: Request,
    body: ResendConfirmationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> None:
    """Re-mint + re-send the confirmation email for an outstanding pending row.

    Always 204, like ``/forgot-password``, so it cannot enumerate pending addresses.
    """
    try:
        mint = registration.resend_pending_registration(db, email=body.email)
    except registration.RegistrationError as exc:
        # No expected path; kept in case the service ever raises.
        _raise_registration_error(exc)

    # Audit on both branches like ``/forgot-password``. ``user_id`` stays NULL
    # so the row leaks nothing about which addresses have a pending row.
    audit.log_auth_event(
        db,
        event=EVENT_REGISTER_RESENT,
        user_id=None,
    )
    db.commit()
    if mint is None:
        return

    background_tasks.add_task(
        _send_registration_confirmation_best_effort,
        to=mint.email,
        raw_token=mint.raw_token,
    )


# ── Login / logout / me ───────────────────────────────────────────────────


@router.post("/login", response_model=UserRead)
@limiter.limit("5/minute;30/hour")
def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == body.email).first()
    # Always run bcrypt (dummy hash for unknown, soft-deleted or credential-less
    # users) so every failure branch takes the same time; otherwise response
    # time is an oracle for known-but-deleted emails.
    password_hash = (
        user.password_hash
        if user is not None and user.deleted_at is None and user.password_hash is not None
        else DUMMY_PASSWORD_HASH
    )
    password_ok = verify_password(body.password, password_hash)
    # The dummy hash's plaintext is public, so a match there must not sign in.
    if (
        user is None
        or user.deleted_at is not None
        or not user.is_active
        or user.password_hash is None
        or not password_ok
    ):
        # Log the matched user_id when there is one, NULL otherwise, so
        # existence is not leaked. A deactivated account is treated like a
        # soft-deleted one.
        audit.log_auth_event(
            db,
            event=EVENT_FAILED_LOGIN,
            user_id=user.id
            if (user is not None and user.deleted_at is None and user.is_active)
            else None,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Re-check ADMIN_EMAILS each login (the env var may be added after registration).
    maybe_promote_admin(user)
    # Sign-in is activity; the ``_touch_last_seen`` throttle would otherwise
    # leave the row stale.
    user.last_seen_at = datetime.now(UTC)
    audit.log_auth_event(
        db,
        event=EVENT_LOGIN,
        user_id=user.id,
    )
    db.commit()

    token = create_access_token(user)
    issue_session_cookies(response, token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    # Idempotent, with or without a session cookie. Mutating the injected
    # ``response`` is what makes FastAPI send the Set-Cookie clear headers.
    # The cookie is decoded best-effort to attach a user_id to the audit row;
    # a bad cookie still gets a row (user_id NULL).
    cookie = request.cookies.get(SESSION_COOKIE)
    user_id: uuid.UUID | None = None
    if cookie:
        payload, reason = decode_session_token_with_reason(cookie)
        if payload is None:
            # WARN so a forged cookie is greppable (a missing cookie is silent).
            logger.warning("logout: rejected session cookie: %s", reason)
        else:
            sub = payload.get("sub")
            if isinstance(sub, str):
                try:
                    user_id = uuid.UUID(sub)
                except ValueError:
                    user_id = None

    # Bump `token_version` so every outstanding session 401s at
    # `get_current_user`. Skipped for a bad or unknown cookie so a guessed sub
    # can't bump arbitrary users' counters.
    if user_id is not None:
        user = db.query(User).filter(User.id == user_id).first()
        if user is not None and user.deleted_at is None:
            bump_token_version(user)

    audit.log_auth_event(
        db,
        event=EVENT_LOGOUT,
        user_id=user_id,
    )
    db.commit()
    clear_session_cookies(response)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user


# ── Recovery: forgot password / reset password ───────────────────────────


def _process_forgot_password(user_id, email_address: str) -> None:
    """Mint + send the reset email out-of-band.

    Runs as a background task after the 204 ships so the no-user and live-user
    branches return at the same time (the slow work would leak existence via
    response time). Owns its DB session because the request-scoped one is closed.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        # Re-fetch: the user may have been soft-deleted since the handler returned.
        user = db.query(User).filter(User.id == user_id).first()
        if user is None or user.deleted_at is not None:
            return

        auth_tokens.revoke_all_live_for_user(db, user_id=user.id, purpose=PURPOSE_PASSWORD_RESET)
        raw_token = auth_tokens.mint(
            db,
            user_id=user.id,
            purpose=PURPOSE_PASSWORD_RESET,
            ttl_minutes=settings.password_reset_token_minutes,
        )
        db.commit()

        try:
            link = _build_link("/reset-password", raw_token)
            email.send(email.password_reset_email(to=email_address, link=link))
        except email.EmailSendError as exc:
            logger.warning("password reset email send failed for user_id=%s: %s", user.id, exc)
    finally:
        db.close()


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> None:
    """Always 204, and at the same time on every branch.

    Any difference in status, body or response time leaks user existence. The
    lookup and audit commit run synchronously on both branches; token work and
    the Resend round-trip go to a background task.
    """

    user = db.query(User).filter(User.email == body.email).first()
    # Audit on both branches; user_id is NULL on the no-op branch so it leaks nothing.
    audit.log_auth_event(
        db,
        event=EVENT_PASSWORD_RESET_REQUESTED,
        user_id=user.id if (user is not None and user.deleted_at is None) else None,
    )
    db.commit()

    if user is None or user.deleted_at is not None:
        # No-op branch: the live-user branch only schedules a task before returning.
        return

    # A found user always has an email (lookup is by email); the column is
    # nullable for legacy rows.
    if user.email is not None:
        background_tasks.add_task(_process_forgot_password, user.id, user.email)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> None:
    row = auth_tokens.consume(db, body.token, PURPOSE_PASSWORD_RESET)
    if row is None:
        # One opaque error for every failure mode, so a probe can't tell
        # whether a leaked token is still live.
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == row.user_id).first()
    # Mirror the mint-side guards (live + active): deactivation has no FK
    # cascade, so a token captured before it would otherwise still rotate the
    # password.
    if user is None or user.deleted_at is not None or not user.is_active:
        # ``consume`` already burned the token; roll back so it isn't persisted
        # without a password change.
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = hash_password(body.new_password)
    # A reset may mean the user never controlled the logged-in devices, so
    # invalidate every outstanding JWT now, not at `exp`.
    bump_token_version(user)
    audit.log_auth_event(
        db,
        event=EVENT_PASSWORD_RESET_COMPLETED,
        user_id=user.id,
    )
    db.commit()


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour", key_func=_session_or_ip_key)
def change_password(
    request: Request,
    response: Response,
    body: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Authenticated password change. Requires the current password.

    Cookie-only auth means a stolen session can act as the user, so
    re-asserting the current password keeps a thief from locking the owner out.
    Same hash + audit shape as ``/auth/reset-password`` so the flows are
    indistinguishable.

    The heads-up email is a best-effort background task after the commit.
    """
    # NULL hash (credential-less account) has no password to re-assert.
    if current_user.password_hash is None or not verify_password(
        body.current_password, current_user.password_hash
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Capture the address before the commit: ``expire_on_commit`` would make a
    # later read lazy-reload, and this keeps the task closure free of ORM state.
    user_id = current_user.id
    notify_to = current_user.email

    current_user.password_hash = hash_password(body.new_password)
    # Bumping `token_version` 401s every JWT minted before now, including this
    # request's; the fresh cookie below keeps this device logged in.
    bump_token_version(current_user)
    audit.log_auth_event(
        db,
        event=EVENT_PASSWORD_CHANGED,
        user_id=user_id,
    )
    db.commit()
    db.refresh(current_user)
    issue_session_cookies(response, create_access_token(current_user))

    if notify_to is not None:
        background_tasks.add_task(
            _send_password_changed_notification_best_effort,
            user_id=user_id,
            to=notify_to,
        )
