"""Pre-creation registration flow: register stages a pending row, confirm creates the user.

``email.send`` (the wire boundary) is patched, so assertions do not depend on email body prose.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.user import User
from app.routers import auth as auth_router
from app.services import email, registration
from app.services.auth_cookies import CSRF_COOKIE, SESSION_COOKIE


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def email_recorder(monkeypatch):

    sent: list[email.Email] = []

    def _record(email_obj: email.Email) -> None:
        sent.append(email_obj)

    monkeypatch.setattr(auth_router.email, "send", _record)
    return sent


@pytest.fixture
def invite_code(db):
    code = f"reg-invite-{uuid.uuid4().hex}"
    row = InviteCode(code=code)
    db.add(row)
    db.commit()
    yield row
    # Drop pending rows and users that reference this invite, then the invite.
    db.query(PendingRegistration).filter(PendingRegistration.invite_code_id == row.id).delete()
    used_user_id = row.used_by
    db.delete(row)
    if used_user_id:
        db.query(User).filter(User.id == used_user_id).delete()
    db.commit()


def _unique_payload(invite_code: InviteCode) -> dict[str, str]:
    handle = uuid.uuid4().hex[:10]
    return {
        "username": f"u{handle}",
        "email": f"{handle}@example.com",
        "password": "validpass123",
        "invite_code": invite_code.code,
    }


def _extract_token(text: str) -> str:
    marker = "?token="
    idx = text.index(marker) + len(marker)
    end = idx
    while end < len(text) and not text[end].isspace():
        end += 1
    return text[idx:end]


def test_register_returns_202_and_no_user_row(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["email"] == payload["email"]
    assert body["status"] == "pending_confirmation"

    # No user row yet: the pending row holds the identity.
    assert db.query(User).filter(User.email == payload["email"]).first() is None
    pending = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
    )
    assert pending is not None
    assert pending.username == payload["username"]
    assert pending.invite_code_id == invite_code.id

    assert len(email_recorder) == 1
    sent = email_recorder[0]
    assert sent.to == payload["email"]
    assert "/confirm-registration?token=" in sent.text


def test_register_does_not_set_session_cookie(client, invite_code, email_recorder):
    response = client.post("/api/v1/auth/register", json=_unique_payload(invite_code))
    assert response.status_code == 202
    # No login cookie until the user proves email control.
    assert SESSION_COOKIE not in client.cookies
    assert CSRF_COOKIE not in client.cookies


def test_register_does_not_consume_invite(client, invite_code, email_recorder, db):
    """An abandoned signup does not burn the invite (``used_at`` is stamped at confirmation)."""
    client.post("/api/v1/auth/register", json=_unique_payload(invite_code))
    db.refresh(invite_code)
    assert invite_code.used_at is None
    assert invite_code.used_by is None


def test_register_rejects_unknown_invite(client, email_recorder, db):
    payload = {
        "username": f"u{uuid.uuid4().hex[:8]}",
        "email": f"{uuid.uuid4().hex}@example.com",
        "password": "validpass123",
        "invite_code": "definitely-not-a-real-code",
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 400
    assert email_recorder == []
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )


def test_register_caps_the_password_at_72_bytes(client, invite_code, email_recorder, db):
    # 36 "é" encode to 72 bytes; one more letter makes 73 bytes in 37 characters.
    at_cap = {**_unique_payload(invite_code), "password": "é" * 36}
    over_cap = {**_unique_payload(invite_code), "password": "é" * 36 + "a"}

    assert client.post("/api/v1/auth/register", json=at_cap).status_code == 202
    response = client.post("/api/v1/auth/register", json=over_cap)
    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "password"]
    assert "72 bytes" in error["msg"]
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == over_cap["email"]).first()
        is None
    )


def test_register_rejects_when_email_is_pending(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202

    # Same email, different username: hits the "in flight" branch, not a DB error.
    again = {**payload, "username": f"alt{uuid.uuid4().hex[:6]}"}
    response = client.post("/api/v1/auth/register", json=again)
    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["code"] == "email_pending_confirmation"
    assert "in flight" in body["detail"]["message"].lower()
    pendings = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).all()
    )
    assert len(pendings) == 1
    assert len(email_recorder) == 1


def test_register_rejects_when_email_already_registered(client, invite_code, email_recorder, db):
    # Existing user with this email: "account exists", not "in flight".
    existing_email = f"prev-{uuid.uuid4().hex}@example.com"
    user = User(
        username=f"prev{uuid.uuid4().hex[:8]}",
        email=existing_email,
        password_hash="x",
    )
    db.add(user)
    db.commit()
    try:
        payload = _unique_payload(invite_code)
        payload["email"] = existing_email
        response = client.post("/api/v1/auth/register", json=payload)
        assert response.status_code == 409
        body = response.json()
        assert body["detail"]["code"] == "email_already_registered"
        assert "already exists" in body["detail"]["message"].lower()
        assert email_recorder == []
    finally:
        db.delete(user)
        db.commit()


def test_register_soft_deleted_user_still_blocks_email(client, invite_code, email_recorder, db):
    """A soft-deleted user keeps its email bound: re-registration is refused."""
    deleted_email = f"deleted-{uuid.uuid4().hex}@example.com"
    user = User(
        username=f"del{uuid.uuid4().hex[:8]}",
        email=deleted_email,
        password_hash="x",
        deleted_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    try:
        payload = _unique_payload(invite_code)
        payload["email"] = deleted_email
        response = client.post("/api/v1/auth/register", json=payload)
        assert response.status_code == 409
        assert email_recorder == []
    finally:
        db.delete(user)
        db.commit()


def test_register_schedules_email_send_via_background_tasks(
    client, invite_code, email_recorder, monkeypatch
):
    """The Resend round-trip is scheduled, not called inline.

    An inline call makes the success branch slower than the error branches
    and leaks state via response time. TestClient runs BackgroundTasks before
    returning, so the test patches ``BackgroundTasks.add_task`` and asserts one
    task with the confirmation sender as callable.
    """
    from fastapi import BackgroundTasks

    scheduled: list[tuple] = []
    original = BackgroundTasks.add_task

    def recording_add_task(self, func, *args, **kwargs):
        scheduled.append((func, args, kwargs))
        return original(self, func, *args, **kwargs)

    monkeypatch.setattr(BackgroundTasks, "add_task", recording_add_task)

    response = client.post("/api/v1/auth/register", json=_unique_payload(invite_code))
    assert response.status_code == 202
    assert len(scheduled) == 1, f"expected exactly one BG task, got {len(scheduled)}"
    func, _args, kwargs = scheduled[0]
    assert func is auth_router._send_registration_confirmation_best_effort
    assert kwargs.get("to") and kwargs.get("raw_token")


def test_confirm_creates_user_and_signs_them_in(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == payload["email"]
    assert body["username"] == payload["username"]

    # Session and CSRF cookies arrive in the same response.
    assert SESSION_COOKIE in client.cookies
    assert CSRF_COOKIE in client.cookies

    user = db.query(User).filter(User.email == payload["email"]).first()
    assert user is not None
    assert user.email_verified_at is not None
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )

    db.refresh(invite_code)
    assert invite_code.used_at is not None
    assert invite_code.used_by == user.id

    db.delete(user)
    db.commit()


def test_confirm_with_invalid_token_returns_400(client, email_recorder):
    response = client.post(
        "/api/v1/auth/confirm-registration",
        json={"token": "x" * 32},  # well-formed length but never minted
    )
    assert response.status_code == 400
    assert SESSION_COOKIE not in client.cookies


def test_confirm_with_expired_token_returns_400(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    pending = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
    )
    assert pending is not None
    pending.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 400
    assert db.query(User).filter(User.email == payload["email"]).first() is None


def test_confirm_with_revoked_invite_returns_400_and_releases_pending(
    client, invite_code, email_recorder, db
):
    """Admin revokes the invite between register and confirm: 400, address released.

    The pending row is deleted (not rolled back) so the user can re-register
    without waiting for the TTL.
    """
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    invite_code.revoked_at = datetime.now(UTC)
    db.commit()

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 400
    body = response.json()
    assert body["detail"]["code"] == "invalid_invite"
    assert "revoked" in body["detail"]["message"].lower()
    # Pending row gone → address released for re-registration.
    db.expire_all()
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )
    assert db.query(User).filter(User.email == payload["email"]).first() is None


def test_confirm_with_expired_invite_returns_400_and_releases_pending(
    client, invite_code, email_recorder, db
):
    """Invite expires between register and confirm → 400, address released."""
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    invite_code.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 400
    body = response.json()
    assert body["detail"]["code"] == "invalid_invite"
    assert "expired" in body["detail"]["message"].lower()
    db.expire_all()
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )


def test_confirm_with_already_consumed_invite_returns_400_and_releases_pending(
    client, invite_code, email_recorder, db
):
    """Invite consumed by another path (two-tab paste) between register and confirm: 400, address released.

    Without the guard the loser loops on the dead invite until the pending TTL.
    """
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    # Simulate another path having consumed the invite.
    invite_code.used_at = datetime.now(UTC)
    db.commit()

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 400
    body = response.json()
    assert body["detail"]["code"] == "invalid_invite"
    assert "already been used" in body["detail"]["message"].lower()
    db.expire_all()
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )


def test_confirm_is_single_use(client, invite_code, email_recorder, db):
    """A second click on the same link fails: the first click deleted the pending row."""
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    first = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert first.status_code == 200
    # Fresh client: no cookie state from the first confirm.
    fresh = TestClient(app)
    second = fresh.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert second.status_code == 400

    db.query(User).filter(User.email == payload["email"]).delete()
    db.commit()


def test_resend_confirmation_returns_204_for_unknown_email(client, email_recorder):
    response = client.post(
        "/api/v1/auth/resend-confirmation",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204
    assert email_recorder == []


def test_resend_confirmation_re_sends_for_live_pending(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    # The resend sends a second email with a different token (the old one is dead).
    first_token = _extract_token(email_recorder[0].text)
    response = client.post("/api/v1/auth/resend-confirmation", json={"email": payload["email"]})
    assert response.status_code == 204
    assert len(email_recorder) == 2
    second_token = _extract_token(email_recorder[1].text)
    assert second_token != first_token

    response = client.post("/api/v1/auth/confirm-registration", json={"token": first_token})
    assert response.status_code == 400


def test_reap_pending_registrations_drops_expired_rows(db, invite_code):
    row = PendingRegistration(
        email=f"expired-{uuid.uuid4().hex}@example.com",
        username=f"exp{uuid.uuid4().hex[:8]}",
        password_hash="x",
        invite_code_id=invite_code.id,
        token_hash="deadbeef",
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(row)
    db.commit()
    row_id = row.id

    result = registration.reap_pending_registrations(db)
    assert result["pending_registrations_deleted"] >= 1
    db.expire_all()  # bulk DELETE doesn't update SQLA's identity map.
    assert db.query(PendingRegistration).filter(PendingRegistration.id == row_id).first() is None


def test_integrity_constraint_lookup_email():
    """The IntegrityError constraint name maps to the email or username pending error via psycopg's ``diag``.

    Unit-tests the extraction helper: a real two-session INSERT race would need a
    controlled gap after the SELECT.
    """
    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError(
        "synthetic",
        {},
        SimpleNamespace(diag=SimpleNamespace(constraint_name="uq_pending_registrations_email")),
    )
    assert registration._integrity_error_constraint(exc) == "uq_pending_registrations_email"


def test_integrity_constraint_lookup_falls_back_to_orig_text():
    """Drivers without ``diag.constraint_name`` fall back to scanning the driver message.

    ``str(exc)`` is not scanned: it includes the INSERT column list, which would match every column.
    """
    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError(
        "synthetic outer",
        {},
        Exception(
            'duplicate key value violates unique constraint "uq_pending_registrations_username"'
        ),
    )
    assert registration._integrity_error_constraint(exc) == "uq_pending_registrations_username"


def test_integrity_constraint_lookup_ignores_str_exc_column_list():
    """``str(IntegrityError)`` (which contains the SQL column list) is not constraint-name evidence.

    Scanning it would misattribute an email collision to ``username``.
    """
    from sqlalchemy.exc import IntegrityError

    # Email collision: orig says so, the SQL message lists "username".
    exc = IntegrityError(
        "INSERT INTO users (id, username, email) VALUES (...)",
        {},
        Exception('duplicate key value violates unique constraint "users_email_key"'),
    )
    assert registration._integrity_error_constraint(exc) == "users_email_key"


def test_integrity_constraint_lookup_users_username():
    """Postgres auto-named ``users_username_key`` is in the scan list."""
    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError(
        "synthetic",
        {},
        Exception('duplicate key value violates unique constraint "users_username_key"'),
    )
    assert registration._integrity_error_constraint(exc) == "users_username_key"


def test_integrity_constraint_lookup_unknown_returns_none():
    """Unknown constraint → None so the caller picks the safe default."""
    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError("ERROR: something unrelated", {}, Exception("opaque"))
    assert registration._integrity_error_constraint(exc) is None


def test_is_username_constraint_defaults_safe():
    """A ``None`` constraint name routes to the email branch, not username.

    Flipping the default would invent username clashes on unrecognised errors.
    """
    assert registration._is_username_constraint(None) is False
    assert registration._is_username_constraint("something_unrecognised") is False
    assert registration._is_username_constraint(registration._PENDING_USERNAME_CONSTRAINT) is True
    assert registration._is_username_constraint(registration._USERS_USERNAME_CONSTRAINT) is True
    assert registration._is_username_constraint(registration._PENDING_EMAIL_CONSTRAINT) is False
    assert registration._is_username_constraint(registration._USERS_EMAIL_CONSTRAINT) is False


def test_consume_invite_code_does_not_over_consume_under_race(db, invite_code):
    """A single-use invite cannot be consumed twice.

    Under READ COMMITTED a read-modify-write would let both threads stamp it;
    the atomic ``UPDATE ... WHERE used_at IS NULL RETURNING`` has one winner.
    """
    import threading

    from app.services.auth import consume_invite_code

    # Real users so the ``invite_codes.used_by`` FK does not fail the test.
    users = [
        User(
            username=f"race-u-{uuid.uuid4().hex[:8]}",
            email=f"race-{uuid.uuid4().hex}@example.com",
            password_hash="x",
        )
        for _ in range(2)
    ]
    for u in users:
        db.add(u)
    db.commit()
    user_ids = [u.id for u in users]

    invite_id = invite_code.id
    results: list[bool] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def worker(user_id):
        session = SessionLocal()
        try:
            invite = session.query(type(invite_code)).filter_by(id=invite_id).first()
            barrier.wait(timeout=2)
            won = consume_invite_code(session, invite, user_id)
            session.commit()
            results.append(won)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            session.close()

    t1 = threading.Thread(target=worker, args=(user_ids[0],))
    t2 = threading.Thread(target=worker, args=(user_ids[1],))
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    try:
        assert errors == [], f"workers raised: {errors}"
        winners = [r for r in results if r]
        assert len(winners) == 1, f"exactly one consume must succeed; got {winners}"
    finally:
        # used_by FK is ON DELETE SET NULL: clear it before deleting the users.
        for u in users:
            db.query(InviteCode).filter(InviteCode.used_by == u.id).update(
                {"used_by": None, "used_at": None}
            )
            db.delete(u)
        db.commit()


def test_confirm_is_atomic_under_parallel_use(client, invite_code, email_recorder, db):
    """Two concurrent confirms with the same token create one user.

    The DELETE-RETURNING claim on ``pending_registrations`` is the single-use
    guard; the loser sees zero rows and gets the opaque 400.
    """
    import threading

    from app.main import app

    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    statuses: list[int] = []
    barrier = threading.Barrier(2)

    def worker():
        c = TestClient(app)
        barrier.wait(timeout=2)
        r = c.post("/api/v1/auth/confirm-registration", json={"token": token})
        statuses.append(r.status_code)

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    winners = [s for s in statuses if s == 200]
    losers = [s for s in statuses if s == 400]
    assert len(winners) == 1, f"exactly one confirm must succeed; got {statuses}"
    assert len(losers) == 1, f"loser must see 400; got {statuses}"

    user = db.query(User).filter(User.email == payload["email"]).first()
    assert user is not None
    db.delete(user)
    db.commit()


def test_register_normalizes_email_case(client, invite_code, email_recorder, db):
    """``Admin@vidit.app`` vs ``admin@vidit.app`` is an admin-escalation vector.

    The case-sensitive UNIQUE on ``users.email`` would let both register and
    ``maybe_promote_admin`` (``.lower()`` match) would promote both. Lowercasing
    at the schema layer makes the UNIQUE catch the second.
    """
    payload = _unique_payload(invite_code)
    payload["email"] = payload["email"].upper()
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 202, response.text
    assert response.json()["email"] == payload["email"].lower()
    # The pending row is keyed lowercased, so a lowercase follow-up hits the in-flight branch.
    assert (
        db.query(PendingRegistration)
        .filter(PendingRegistration.email == payload["email"].lower())
        .first()
        is not None
    )


def test_reap_pending_registrations_keeps_live_rows(db, invite_code):
    row = PendingRegistration(
        email=f"alive-{uuid.uuid4().hex}@example.com",
        username=f"live{uuid.uuid4().hex[:8]}",
        password_hash="x",
        invite_code_id=invite_code.id,
        token_hash="deadbeef-live",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.add(row)
    db.commit()
    try:
        registration.reap_pending_registrations(db)
        assert (
            db.query(PendingRegistration).filter(PendingRegistration.id == row.id).first()
            is not None
        )
    finally:
        db.delete(row)
        db.commit()


def test_confirm_copies_invite_x_handle_onto_account(client, invite_code, email_recorder, db):
    bound = f"bh{uuid.uuid4().hex[:10]}"
    invite_code.x_handle = bound
    db.commit()

    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)
    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 200, response.text

    user = db.query(User).filter(User.email == payload["email"]).first()
    assert user is not None
    assert user.x_handle == bound

    db.delete(user)
    db.commit()


def test_confirm_survives_taken_x_handle_and_skips_link(
    client, invite_code, email_recorder, db, caplog
):
    """A handle linked to another account between mint and redemption: registration succeeds without the link.

    The admin x-handle endpoint is the repair path.
    """
    bound = f"bh{uuid.uuid4().hex[:10]}"
    holder = User(
        username=f"holder{uuid.uuid4().hex[:8]}",
        email=f"holder-{uuid.uuid4().hex}@example.com",
        password_hash="x",
        x_handle=bound,
    )
    db.add(holder)
    invite_code.x_handle = bound
    db.commit()
    holder_id = holder.id

    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)
    with caplog.at_level(logging.WARNING, logger="app.services.registration"):
        response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 200, response.text
    assert any("without the link" in record.getMessage() for record in caplog.records)

    user = db.query(User).filter(User.email == payload["email"]).first()
    assert user is not None
    assert user.x_handle is None

    db.delete(user)
    db.query(User).filter(User.id == holder_id).delete(synchronize_session=False)
    db.commit()
