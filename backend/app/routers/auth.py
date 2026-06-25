import hashlib
import logging
import uuid
from typing import NoReturn
from urllib.parse import urlencode

import jwt
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

    Keying on the session (not source IP) avoids two-analysts-behind-one-
    NAT collisions. The cookie is hashed so the rate-limiter store holds
    only a stable opaque key, never the raw JWT. Falls back to
    :func:`rate_limit_key` (right-most-XFF aware, so unspoofable via
    ``X-Forwarded-For`` rotation) when no session cookie is present.
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

    A Resend outage must not fail the rotation — the credential is
    already written by the time this runs; the email is a heads-up, not
    a gate. Logs ``user_id`` not the address: Resend already echoes the
    recipient on every send, so duplicating it here would needlessly
    widen where the user→address mapping leaks (it lives in ``users`` /
    ``auth_events`` for anyone who needs it).
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

    A Resend outage during /register would otherwise fail the request
    after the pending row already exists; the user can hit "resend
    confirmation" if the email never arrives.
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
    """Translate a typed registration error into a structured HTTP response."""
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
    """Stage a registration. No ``users`` row is created here.

    Returns ``202 Accepted`` with the email on file. The actual account
    is created at ``POST /auth/confirm-registration`` when the user
    clicks the link in the confirmation email. The user is NOT signed
    in by this call — no cookie is set.
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

    audit.log_auth_event_from_request(
        db,
        request,
        event=EVENT_REGISTER_PENDING,
    )
    db.commit()

    # Dispatch the send off-thread (same timing-equalisation as
    # /forgot-password): the Resend round-trip is hundreds of ms, so
    # keeping it inline would make the success branch slower than the
    # already-registered / already-pending branches and leak state via
    # response time.
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

    Single round-trip: re-validates the invite + uniqueness inside the
    same transaction as the user insert (the pending row was holding
    the address until now), then issues the session cookies. The
    analyst lands on the post-confirm page already logged in.
    """
    try:
        user = registration.confirm_pending_registration(db, body.token)
    except registration.RegistrationError as exc:
        _raise_registration_error(exc)

    audit.log_auth_event_from_request(
        db,
        request,
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

    Always 204 regardless of input: matches the ``/forgot-password``
    discipline so the response cannot enumerate addresses with live
    pending registrations.
    """
    try:
        mint = registration.resend_pending_registration(db, email=body.email)
    except registration.RegistrationError as exc:
        # No expected RegistrationError path under resend, but keep the
        # mapping for safety if the service ever raises.
        _raise_registration_error(exc)

    # Audit on BOTH branches — same discipline as ``/forgot-password``.
    # ``user_id`` stays NULL (no ``users`` row exists for a pending
    # registration yet), so the row records "a resend was attempted from
    # this IP" without leaking which addresses have a live pending row.
    audit.log_auth_event_from_request(
        db,
        request,
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


@router.get("/invites/{code}/check")
def check_invite_code(code: str, db: Session = Depends(get_db)):
    from app.services.auth import validate_invite_code

    invite = validate_invite_code(db, code)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    return {"valid": True}


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
    # Always run bcrypt — real hash for a live user, dummy hash otherwise —
    # so the unknown-email and soft-deleted branches take the same time as
    # the wrong-password branch. Without the dummy verify, response time is
    # a free oracle for "is this email a known-but-deleted user?".
    # A credential-less profile (password_hash NULL — an unclaimed assembled
    # profile, or a future OAuth-only claim) takes the dummy-verify branch: it
    # can't authenticate by password, and the constant-time path is preserved.
    password_hash = (
        user.password_hash
        if user is not None and user.deleted_at is None and user.password_hash is not None
        else DUMMY_PASSWORD_HASH
    )
    password_ok = verify_password(body.password, password_hash)
    if user is None or user.deleted_at is not None or not password_ok:
        # Log failed_login with the matched user_id when we have one (so
        # "failed attempts against this account" is queryable), NULL
        # when the email didn't match (so we don't leak existence by
        # writing a probe-able mapping). Same row shape either way.
        audit.log_auth_event_from_request(
            db,
            request,
            event=EVENT_FAILED_LOGIN,
            user_id=user.id if (user is not None and user.deleted_at is None) else None,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Re-check ADMIN_EMAILS each login — covers the case where the env var
    # was added (or the address rotated in) after the user registered.
    maybe_promote_admin(user)
    audit.log_auth_event_from_request(
        db,
        request,
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
    # Idempotent: works with or without a session cookie. Mutating the
    # injected ``response`` (not returning a new one) is what makes FastAPI
    # send the Set-Cookie clear headers.
    #
    # Decode the cookie best-effort to attach a user_id to the audit row.
    # A malformed / expired / missing cookie still gets a row (user_id
    # NULL) so "any logout-shaped request from this IP" stays queryable;
    # we just can't tell who it claimed to be.
    cookie = request.cookies.get(SESSION_COOKIE)
    user_id: uuid.UUID | None = None
    if cookie:
        try:
            payload = jwt.decode(
                cookie,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
            )
            sub = payload.get("sub")
            if isinstance(sub, str):
                try:
                    user_id = uuid.UUID(sub)
                except ValueError:
                    user_id = None
        except jwt.InvalidTokenError as exc:
            # Tampered / expired / malformed cookie. Still log the logout
            # (user_id NULL) so the request is queryable, but WARN so the
            # line is greppable — legitimate-no-cookie and forged-cookie
            # cases produce identical silent NULLs otherwise.
            logger.warning("logout: rejected session cookie: %s", exc)

    # Invalidate every outstanding session for this user, not just the
    # cookie on this device, by bumping `token_version` so older JWTs 401
    # at `get_current_user` (interim until a refresh-token system lands).
    # Skip on a malformed / missing / unknown-user cookie — otherwise an
    # attacker could spam /logout with a guessed sub to bump arbitrary
    # users' counters, and there's nothing to invalidate anyway.
    if user_id is not None:
        user = db.query(User).filter(User.id == user_id).first()
        if user is not None and user.deleted_at is None:
            bump_token_version(user)

    audit.log_auth_event_from_request(
        db,
        request,
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

    Runs as a background task *after* the 204 ships, so the no-user and
    live-user branches return at the same time. The work (DB UPDATE,
    token mint, Resend round-trip) is hundreds of ms — keeping it on the
    request thread is what leaks user existence via response time,
    regardless of any rate limit. Owns its own DB session because the
    request-scoped one in `forgot_password` is already closed.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        # Re-fetch — the user could have been soft-deleted in the gap
        # between the request handler returning and this task firing.
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
    """Always 204, regardless of input — and at the same time on every branch.

    Any difference (status code, body, **response time**) leaks user
    existence and turns this into a free enumeration oracle. The DB lookup
    + audit commit run synchronously on both branches, so timing doesn't
    differentiate them; the expensive work (token revoke, mint, Resend
    round-trip) is dispatched to a background task so wire timing is
    identical whether or not the email matched. The rate limit slows
    enumeration; the timing fix kills the oracle.
    """

    user = db.query(User).filter(User.email == body.email).first()
    # Audit on BOTH branches — keeps wire timing identical and makes "any
    # /forgot-password request from this IP" queryable regardless of match.
    # user_id is NULL on the no-op branch so we don't leak existence via a
    # probe-able mapping.
    audit.log_auth_event_from_request(
        db,
        request,
        event=EVENT_PASSWORD_RESET_REQUESTED,
        user_id=user.id if (user is not None and user.deleted_at is None) else None,
    )
    db.commit()

    if user is None or user.deleted_at is not None:
        # No-op branch: 204 in roughly the same time as the live-user
        # branch, which only schedules the background task before returning.
        return

    # No email = nothing to send to (a found user always has one — lookup is by
    # email — but the column is nullable for assembled profiles).
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
        # Same opaque error for every failure mode (unknown / expired /
        # already-consumed / wrong-purpose). Granular errors would help an
        # attacker probing whether a known-leaked token is still live.
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == row.user_id).first()
    # Mirror the mint-side guards (live + active account): without this
    # parity an attacker holding a token captured before the account was
    # disabled could still rotate the password. Soft-delete FK-cascades
    # the token row away so that case is rare, but deactivation has no
    # cascade and would otherwise sneak through.
    if user is None or user.deleted_at is not None or not user.is_active:
        # ``consume`` already flipped ``consumed_at``. Roll back so the
        # burned token isn't persisted without a matching password change.
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = hash_password(body.new_password)
    # Invalidate every outstanding session: a reset means the user may
    # never have controlled the logged-in devices, so every existing JWT
    # must stop working now, not at its `exp`. Re-login mints a fresh
    # cookie with the bumped `tv`.
    bump_token_version(user)
    audit.log_auth_event_from_request(
        db,
        request,
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

    Cookie-only auth means a stolen session can act as the user —
    re-asserting the current password keeps a thief from rotating the
    credential and locking the owner out. Same hash + audit shape as
    ``/auth/reset-password`` so an attacker can't tell the flows apart in
    timing or audit columns.

    The heads-up email fires after the commit, dispatched as a background
    task so a slow Resend round-trip doesn't pad the wire response and
    best-effort so a provider outage doesn't fail a completed rotation.
    """
    # `password_hash` is None only for a credential-less account (a future
    # OAuth-only claim has no password to re-assert) — reject like a wrong
    # password; a dedicated set-password flow lands with OAuth claim.
    if current_user.password_hash is None or not verify_password(
        body.current_password, current_user.password_hash
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Capture the address *before* the commit. ``expire_on_commit`` (the
    # SQLAlchemy default, not overridden on ``SessionLocal``) means reading
    # ``current_user.email`` after the commit triggers a lazy reload that
    # works today only because the request-scoped session is still alive —
    # it would break the moment the commit moved out of the handler.
    # Pulling the string out also keeps the task closure free of ORM state.
    user_id = current_user.id
    notify_to = current_user.email

    current_user.password_hash = hash_password(body.new_password)
    # Invalidate every other open session: bumping `token_version` 401s
    # every JWT minted before now, including this request's. Re-issuing a
    # fresh cookie on the same response (below) keeps the current device
    # logged in; the others lose access at their next request.
    bump_token_version(current_user)
    audit.log_auth_event_from_request(
        db,
        request,
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
