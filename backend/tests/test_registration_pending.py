"""End-to-end tests for the pre-creation registration flow.

The contract we want to lock in:

* ``POST /auth/register`` does NOT create a ``users`` row. It stages
  the request in ``pending_registrations`` and emails a confirmation
  link.
* ``POST /auth/confirm-registration`` consumes the token, creates the
  ``users`` row, marks the invite consumed, and issues the session +
  CSRF cookies.
* Pending rows pin the email + username until either confirmation or
  expiry. Re-registering with the same address while pending is in
  flight returns a friendly "in flight" error rather than an opaque
  500 on a unique-constraint violation.
* The invite is held by the pending row (the FK) but its ``use_count``
  is only incremented at confirmation — an abandoned signup must NOT
  burn the invite.
* The reaper drops expired rows.
* All errors map to a documented HTTP status; the soft-verify
  ``/auth/verify-email`` endpoint is gone.

We monkeypatch ``email.send`` (the wire boundary) rather than the
template helpers so the assertion is "we tried to send a link to the
right address" without coupling to the prose of the email body.
"""

from __future__ import annotations

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

# ── Fixtures ──────────────────────────────────────────────────────────────


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
    """Capture every email.send() call in order."""

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
    # Cascading cleanup: drop any pending rows / users that reference
    # this invite, then the invite itself.
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


# ── Register: stages a pending row, sends the email, does NOT create user ──


def test_register_returns_202_and_no_user_row(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["email"] == payload["email"]
    assert body["status"] == "pending_confirmation"

    # No user row yet — the pending row is holding the identity.
    assert db.query(User).filter(User.email == payload["email"]).first() is None
    pending = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
    )
    assert pending is not None
    assert pending.username == payload["username"]
    assert pending.invite_code_id == invite_code.id

    # And the confirmation email went to the right address with a link.
    assert len(email_recorder) == 1
    sent = email_recorder[0]
    assert sent.to == payload["email"]
    assert "/confirm-registration?token=" in sent.text


def test_register_does_not_set_session_cookie(client, invite_code, email_recorder):
    response = client.post("/api/v1/auth/register", json=_unique_payload(invite_code))
    assert response.status_code == 202
    # No login cookie should be set — the user proves email control first.
    assert SESSION_COOKIE not in client.cookies
    assert CSRF_COOKIE not in client.cookies


def test_register_does_not_consume_invite(client, invite_code, email_recorder, db):
    """An abandoned signup must NOT burn the invite. The use_count is
    bumped at confirmation time, not register time."""
    client.post("/api/v1/auth/register", json=_unique_payload(invite_code))
    db.refresh(invite_code)
    assert invite_code.use_count == 0
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


def test_register_rejects_when_email_is_pending(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202

    # Second register with the same email but a different username — must hit
    # the friendly "in flight" branch, not an opaque DB error.
    again = {**payload, "username": f"alt{uuid.uuid4().hex[:6]}"}
    response = client.post("/api/v1/auth/register", json=again)
    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["code"] == "email_pending_confirmation"
    assert "in flight" in body["detail"]["message"].lower()
    # Exactly one pending row + exactly one email.
    pendings = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).all()
    )
    assert len(pendings) == 1
    assert len(email_recorder) == 1


def test_register_rejects_when_email_already_registered(client, invite_code, email_recorder, db):
    # Pre-existing user with this email — register must error with the
    # "account exists" message, not the "in flight" one.
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
    """A soft-deleted user keeps its email bound — re-registration must
    NOT slip past the live-user check."""
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
    """The Resend round-trip must be scheduled, not called inline.

    Without this, the success branch is hundreds of ms slower than the
    "already pending" / "already registered" error branches and leaks
    state via response time. The TestClient runs BackgroundTasks
    before handing us the response, so a "was it called?" check can't
    distinguish "scheduled" from "called inline".

    Instead we patch ``BackgroundTasks.add_task`` itself and assert
    that the handler scheduled exactly one task with the
    confirmation-sender as its callable. That catches a refactor that
    quietly moves ``email.send`` back onto the request thread.
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


# ── Confirm: creates the user, consumes the invite, signs them in ──


def test_confirm_creates_user_and_signs_them_in(client, invite_code, email_recorder, db):
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == payload["email"]
    assert body["username"] == payload["username"]

    # Session + CSRF cookies set in the same response so the analyst
    # lands on the post-confirm page already logged in.
    assert SESSION_COOKIE in client.cookies
    assert CSRF_COOKIE in client.cookies

    # User row exists, email_verified_at populated, pending row gone.
    user = db.query(User).filter(User.email == payload["email"]).first()
    assert user is not None
    assert user.email_verified_at is not None
    assert (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
        is None
    )

    # Invite consumed exactly now.
    db.refresh(invite_code)
    assert invite_code.use_count == 1
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

    # Backdate the pending row past expiry.
    pending = (
        db.query(PendingRegistration).filter(PendingRegistration.email == payload["email"]).first()
    )
    assert pending is not None
    pending.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 400
    # And no user was created.
    assert db.query(User).filter(User.email == payload["email"]).first() is None


def test_confirm_with_revoked_invite_returns_400_and_releases_pending(
    client, invite_code, email_recorder, db
):
    """Admin revokes the invite between register and confirm → 400, address released.

    The pending row must be deleted (not rolled back) so the user can
    re-register with a fresh invite without waiting 24h for the TTL.
    Pins the "commit DELETE on dead-invite" behavior the seeder
    review (round 3, C1) pushed back on.
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
    """Same invite consumed by another path (typo retry, two-tab paste) → 400,
    address released so the loser can re-register under a fresh invite.

    Without this guard the loser would loop forever on the dead invite
    until the 24h pending TTL expired.
    """
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    # Simulate another path having consumed the invite.
    invite_code.use_count = invite_code.max_uses
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
    """A second click on the same link must fail — the pending row was
    deleted by the first click, so the token is dead."""
    payload = _unique_payload(invite_code)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = _extract_token(email_recorder[0].text)

    first = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert first.status_code == 200
    # Fresh client to avoid mixing cookie state from the first confirm.
    fresh = TestClient(app)
    second = fresh.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert second.status_code == 400

    db.query(User).filter(User.email == payload["email"]).delete()
    db.commit()


# ── Resend: idempotent, always 204 ──


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
    # One email so far. Issue a resend; expect a second send with a
    # *different* token (the old one is dead).
    first_token = _extract_token(email_recorder[0].text)
    response = client.post("/api/v1/auth/resend-confirmation", json={"email": payload["email"]})
    assert response.status_code == 204
    assert len(email_recorder) == 2
    second_token = _extract_token(email_recorder[1].text)
    assert second_token != first_token

    # Stale token from the first email no longer confirms.
    response = client.post("/api/v1/auth/confirm-registration", json={"token": first_token})
    assert response.status_code == 400


# ── Reaper ──


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


# ── Race / IntegrityError mapping ──


def test_integrity_constraint_lookup_email():
    """Email UNIQUE name on the IntegrityError maps via psycopg's ``diag``.

    Unit-tests the constraint-extraction helper that decides whether a
    UNIQUE-violation INSERT race surfaces ``EmailPendingError`` or
    ``UsernamePendingError``. Driving this end-to-end (real race
    against real Postgres) would require a controlled gap between
    the application-layer SELECT and the INSERT in two sessions; the
    helper's behavior is the part that's actually fragile.
    """
    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError(
        "synthetic",
        {},
        SimpleNamespace(diag=SimpleNamespace(constraint_name="uq_pending_registrations_email")),
    )
    assert registration._integrity_error_constraint(exc) == "uq_pending_registrations_email"


def test_integrity_constraint_lookup_username():
    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError

    exc = IntegrityError(
        "synthetic",
        {},
        SimpleNamespace(diag=SimpleNamespace(constraint_name="uq_pending_registrations_username")),
    )
    assert registration._integrity_error_constraint(exc) == "uq_pending_registrations_username"


def test_integrity_constraint_lookup_falls_back_to_orig_text():
    """Drivers without ``diag.constraint_name`` fall back to scanning ``str(orig)``.

    We deliberately do NOT scan ``str(exc)`` — that includes the
    parametrised INSERT SQL with the column list, so a naive
    substring search would always match every column name. The
    fallback path only looks at the driver's own message.
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
    """``str(IntegrityError)`` contains the SQL column list — it must NOT be
    treated as constraint-name evidence.

    The full str(exc) for a real users-table violation includes
    ``INSERT INTO users (id, username, email, ...)``. If the helper
    naively scans str(exc), it sees ``username`` and misattributes an
    email collision as a username clash. This regression test pins
    the helper to *driver-message* scanning only.
    """
    from sqlalchemy.exc import IntegrityError

    # Real email collision: orig says so, but the SQL message (the
    # first arg) contains the column list with "username" in it.
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
    """``None`` constraint name routes to the email branch, NOT username.

    Pins the "unknown-driver default" mapping — a future refactor that
    flips the default to username would silently invent username
    clashes on every otherwise-unrecognised IntegrityError.
    """
    assert registration._is_username_constraint(None) is False
    assert registration._is_username_constraint("something_unrecognised") is False
    assert registration._is_username_constraint(registration._PENDING_USERNAME_CONSTRAINT) is True
    assert registration._is_username_constraint(registration._USERS_USERNAME_CONSTRAINT) is True
    assert registration._is_username_constraint(registration._PENDING_EMAIL_CONSTRAINT) is False
    assert registration._is_username_constraint(registration._USERS_EMAIL_CONSTRAINT) is False


def test_consume_invite_code_does_not_over_consume_under_race(db, invite_code):
    """A single-use invite must not be consumable twice.

    Two threads calling ``consume_invite_code`` against the same
    ``max_uses=1`` invite under READ COMMITTED would, with the
    previous read-modify-write pattern, both observe ``use_count=0``
    and both bump to ``1`` — the headline C1 regression. The atomic
    ``UPDATE ... WHERE use_count < max_uses RETURNING`` guarantees
    one winner.
    """
    import threading

    from app.services.auth import consume_invite_code

    # Pre-create two real users so the FK on ``invite_codes.used_by``
    # doesn't fail the test for an unrelated reason.
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
        # invite_codes.used_by FK is ON DELETE SET NULL; clear it
        # before deleting the users to keep the audit row valid.
        for u in users:
            db.query(InviteCode).filter(InviteCode.used_by == u.id).update(
                {"used_by": None, "used_at": None}
            )
            db.delete(u)
        db.commit()


def test_confirm_is_atomic_under_parallel_use(client, invite_code, email_recorder, db):
    """Two concurrent confirms with the same token must not both create a user.

    The DELETE-RETURNING claim on ``pending_registrations`` is the
    single-use guard. The losing thread sees zero rows and returns
    the same opaque 400 as any other invalid-token failure.
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


# ── Reaper (continued) ──


def test_register_normalizes_email_case(client, invite_code, email_recorder, db):
    """The ``Admin@vidit.app`` vs ``admin@vidit.app`` collision is the
    admin-escalation vector: the case-sensitive UNIQUE on ``users.email``
    would otherwise let both register, and ``maybe_promote_admin``'s
    ``.lower()`` allowlist match would flip ``is_admin=True`` on both.
    Lowercasing at the schema layer means the UNIQUE catches the second.
    """
    payload = _unique_payload(invite_code)
    payload["email"] = payload["email"].upper()  # POST a mixed-case address
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 202, response.text
    # Response body is the stored, lowercased address.
    assert response.json()["email"] == payload["email"].lower()
    # And the pending row is keyed under the lowercased value, so a
    # follow-up POST with the lowercase form hits the in-flight branch
    # instead of slipping past the SELECT.
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
