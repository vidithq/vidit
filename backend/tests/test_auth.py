"""``services.auth.validate_invite_code``: which invite codes are usable.

The one gate ``POST /auth/register`` runs before it mints a pending
registration, so the rules are pinned here rather than through a route.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.database import SessionLocal
from app.models.invite_code import InviteCode
from app.models.user import User
from app.services.auth import validate_invite_code


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def fresh_invite(db):
    code = f"test-invite-{uuid.uuid4().hex}"
    invite = InviteCode(code=code)
    db.add(invite)
    db.commit()
    yield invite
    db.delete(invite)
    db.commit()


def test_unknown_code_is_not_usable(db):
    assert validate_invite_code(db, f"does-not-exist-{uuid.uuid4().hex}") is None


def test_fresh_code_is_usable(db, fresh_invite):
    assert validate_invite_code(db, fresh_invite.code) is not None


def test_validation_does_not_consume_the_code(db, fresh_invite):
    validate_invite_code(db, fresh_invite.code)
    db.refresh(fresh_invite)
    assert fresh_invite.used_by is None
    assert fresh_invite.used_at is None


def test_exhausted_code_is_not_usable(db, fresh_invite):
    user = User(
        username=f"u{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex}@example.test",
        password_hash="x",
    )
    db.add(user)
    db.flush()
    # Exhaustion is governed by ``used_at``, not by ``used_by``: the FK is
    # nulled when the redeemer's account is erased, the stamp is not.
    fresh_invite.used_by = user.id
    fresh_invite.used_at = datetime.now(UTC)
    db.commit()

    try:
        assert validate_invite_code(db, fresh_invite.code) is None
    finally:
        # Detach the FK before fresh_invite teardown deletes the invite row
        fresh_invite.used_by = None
        db.commit()
        db.delete(user)
        db.commit()


def test_revoked_code_is_not_usable(db, fresh_invite):
    fresh_invite.revoked_at = datetime.now(UTC)
    db.commit()
    assert validate_invite_code(db, fresh_invite.code) is None


def test_code_whose_redeemer_was_erased_stays_unusable(db):
    """``used_by`` is nulled when the account is erased; the code stays spent."""
    code = f"test-erased-{uuid.uuid4().hex}"
    invite = InviteCode(code=code, used_by=None, used_at=datetime.now(UTC))
    db.add(invite)
    db.commit()
    try:
        assert validate_invite_code(db, code) is None
    finally:
        db.delete(invite)
        db.commit()


def test_expired_code_is_not_usable(db):
    code = f"test-expired-{uuid.uuid4().hex}"
    invite = InviteCode(code=code, expires_at=datetime.now(UTC) - timedelta(days=1))
    db.add(invite)
    db.commit()
    try:
        assert validate_invite_code(db, code) is None
    finally:
        db.delete(invite)
        db.commit()
