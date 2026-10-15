"""Product update emails: the consent record (sign-up, Settings, unsubscribe
token), the admin send and the worker's throttled drain."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.product_update import (
    ProductUpdate,
    ProductUpdateConsent,
    ProductUpdateDelivery,
)
from app.models.user import User
from app.services import email, product_updates
from app.services.auth import hash_password
from app.services.product_update_consent import unsubscribe_token
from tests.conftest import login_as

client = TestClient(app)
_ADMIN = "/api/v1/admin/product-updates"
_PREFS = "/api/v1/users/me/preferences"
_UNSUBSCRIBE = "/api/v1/product-updates/unsubscribe"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def outbox(monkeypatch) -> list[email.Email]:
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    return sent


@pytest.fixture
def make_user(db):
    """A user factory; every user it made, and what they sent, goes at teardown."""
    made: list[uuid.UUID] = []

    def _make(*, verified: bool = True, consent: bool = False, admin: bool = False) -> User:
        handle = uuid.uuid4().hex[:10]
        user = User(
            username=f"pu{handle}",
            email=f"pu-{handle}@example.com",
            password_hash=hash_password("password123"),
            email_verified_at=datetime.now(UTC) if verified else None,
            is_admin=admin,
        )
        db.add(user)
        db.flush()
        if consent:
            db.add(
                ProductUpdateConsent(user_id=user.id, source="settings", granted_at=user.created_at)
            )
        db.commit()
        made.append(user.id)
        return user

    client.cookies.clear()
    yield _make
    client.cookies.clear()
    db.rollback()
    db.query(ProductUpdate).filter(ProductUpdate.sent_by.in_(made)).delete(
        synchronize_session=False
    )
    db.query(AdminEvent).filter(AdminEvent.actor_id.in_(made)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(made)).delete(synchronize_session=False)
    db.commit()


def _label() -> str:
    return f"{uuid.uuid4().int % 10_000}.{uuid.uuid4().int % 10_000}.0"


def _announcement(**overrides: object) -> dict[str, object]:
    return {
        "label": _label(),
        "title": "Collections and approvals",
        "body": "Vidit has a new release.\n\n- Collections\n- Approvals",
        "link_url": "https://vidit.app/about",
        **overrides,
    }


def _consents(db, user: User) -> list[ProductUpdateConsent]:
    db.expire_all()
    return (
        db.query(ProductUpdateConsent)
        .filter(ProductUpdateConsent.user_id == user.id)
        .order_by(ProductUpdateConsent.granted_at)
        .all()
    )


def _deliveries(db, update_id: str) -> list[ProductUpdateDelivery]:
    db.expire_all()
    return (
        db.query(ProductUpdateDelivery)
        .filter(ProductUpdateDelivery.product_update_id == uuid.UUID(update_id))
        .all()
    )


def _send(admin: User, **overrides: object) -> dict:
    headers = login_as(client, admin)
    response = client.post(_ADMIN, json=_announcement(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# Consent


def test_consent_is_off_by_default(db, make_user):
    user = make_user()
    login_as(client, user)
    assert client.get(_PREFS).json()["product_updates"] is False
    assert _consents(db, user) == []


def _register(invite: InviteCode, outbox: list[email.Email], **extra: object) -> str:
    handle = uuid.uuid4().hex[:10]
    payload = {
        "username": f"pr{handle}",
        "email": f"pr-{handle}@example.com",
        "password": "validpass123",
        "invite_code": invite.code,
        **extra,
    }
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    link = next(m.text for m in outbox if m.to == payload["email"])
    token = link.split("?token=", 1)[1].split()[0]
    confirmed = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["id"]


@pytest.fixture
def invite(db):
    row = InviteCode(code=f"pu-invite-{uuid.uuid4().hex}")
    db.add(row)
    db.commit()
    yield row
    db.query(PendingRegistration).filter(PendingRegistration.invite_code_id == row.id).delete()
    db.expire_all()
    used_by = db.get_one(InviteCode, row.id).used_by
    db.query(InviteCode).filter(InviteCode.id == row.id).delete()
    if used_by:
        db.query(User).filter(User.id == used_by).delete()
    db.commit()


def test_sign_up_switch_on_records_a_sign_up_consent(db, invite, outbox):
    client.cookies.clear()
    before = datetime.now(UTC)
    user_id = _register(invite, outbox, product_updates=True)
    db.expire_all()
    [consent] = db.query(ProductUpdateConsent).filter_by(user_id=uuid.UUID(user_id)).all()
    assert consent.source == "sign_up"
    assert consent.withdrawn_at is None
    # The time of the request, not of the confirmation click.
    assert before <= consent.granted_at <= datetime.now(UTC)
    client.cookies.clear()


def test_sign_up_without_the_switch_records_nothing(db, invite, outbox):
    client.cookies.clear()
    user_id = _register(invite, outbox)
    db.expire_all()
    assert db.query(ProductUpdateConsent).filter_by(user_id=uuid.UUID(user_id)).count() == 0
    client.cookies.clear()


def test_settings_toggle_keeps_every_grant_and_withdrawal(db, make_user):
    user = make_user()
    headers = login_as(client, user)

    on = client.patch(_PREFS, json={"product_updates": True}, headers=headers)
    assert on.status_code == 200 and on.json()["product_updates"] is True
    off = client.patch(_PREFS, json={"product_updates": False}, headers=headers)
    assert off.json()["product_updates"] is False
    client.patch(_PREFS, json={"product_updates": True}, headers=headers)
    # Turning it on again while on opens no second record.
    client.patch(_PREFS, json={"product_updates": True}, headers=headers)

    first, second = _consents(db, user)
    assert (first.source, second.source) == ("settings", "settings")
    assert first.withdrawn_at is not None
    assert second.withdrawn_at is None


# Unsubscribe token


def test_unsubscribe_token_withdraws_without_a_session(db, make_user):
    user = make_user(consent=True)
    client.cookies.clear()
    response = client.post(_UNSUBSCRIBE, params={"token": unsubscribe_token(user.id)})
    assert response.status_code == 204, response.text
    [consent] = _consents(db, user)
    assert consent.withdrawn_at is not None
    # Idempotent.
    again = client.post(_UNSUBSCRIBE, params={"token": unsubscribe_token(user.id)})
    assert again.status_code == 204


def test_one_click_post_with_a_stale_session_needs_no_csrf_token(db, make_user):
    user = make_user(consent=True)
    login_as(client, user)
    response = client.post(
        _UNSUBSCRIBE,
        params={"token": unsubscribe_token(user.id)},
        content="List-Unsubscribe=One-Click",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 204, response.text
    assert _consents(db, user)[0].withdrawn_at is not None


@pytest.mark.parametrize(
    "tamper",
    [
        lambda token, other: token[:-2] + ("AA" if not token.endswith("AA") else "BB"),
        lambda token, other: other.hex + "." + token.split(".", 1)[1],
        lambda token, other: token.split(".", 1)[0],
        lambda token, other: "not-a-token",
    ],
    ids=["signature", "swapped-user", "unsigned", "garbage"],
)
def test_tampered_token_is_refused(db, make_user, tamper):
    user = make_user(consent=True)
    other = make_user(consent=True)
    client.cookies.clear()
    response = client.post(
        _UNSUBSCRIBE, params={"token": tamper(unsubscribe_token(user.id), other.id)}
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_unsubscribe_token"
    assert _consents(db, user)[0].withdrawn_at is None
    assert _consents(db, other)[0].withdrawn_at is None


def test_token_never_expires_but_a_secret_rotation_voids_it(db, make_user, monkeypatch):
    """No expiry: the link in an email sent long ago, before a re-grant, still
    unsubscribes. A rotated ``JWT_SECRET`` voids every link."""
    user = make_user(consent=True)
    old_link_token = unsubscribe_token(user.id)
    headers = login_as(client, user)
    client.patch(_PREFS, json={"product_updates": False}, headers=headers)
    client.patch(_PREFS, json={"product_updates": True}, headers=headers)
    client.cookies.clear()
    assert client.post(_UNSUBSCRIBE, params={"token": old_link_token}).status_code == 204
    assert all(c.withdrawn_at is not None for c in _consents(db, user))

    monkeypatch.setattr(settings, "jwt_secret", "rotated-" + uuid.uuid4().hex)
    assert client.post(_UNSUBSCRIBE, params={"token": old_link_token}).status_code == 400


# Admin send


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", _ADMIN, None),
        ("post", _ADMIN, _announcement()),
        ("post", f"{_ADMIN}/preview", _announcement()),
        ("post", f"{_ADMIN}/test", _announcement()),
    ],
)
def test_admin_routes_refuse_analysts_and_anonymous(make_user, outbox, method, path, body):
    client.cookies.clear()
    assert client.request(method.upper(), path, json=body).status_code == 401
    headers = login_as(client, make_user())
    assert client.request(method.upper(), path, json=body, headers=headers).status_code == 403
    assert outbox == []


def test_a_patch_label_is_refused(make_user):
    headers = login_as(client, make_user(admin=True))
    for label in ("1.2.3", "1.2", "v1.2.0", "1.2.0-rc1"):
        response = client.post(
            f"{_ADMIN}/preview", json=_announcement(label=label), headers=headers
        )
        assert response.status_code == 422, label


def test_preview_renders_the_email_and_the_pace(make_user, monkeypatch):
    monkeypatch.setattr(settings, "product_update_email_daily_cap", 2)
    admin = make_user(admin=True)
    for _ in range(3):
        make_user(consent=True)
    headers = login_as(client, admin)
    body = _announcement()
    response = client.post(f"{_ADMIN}/preview", json=body, headers=headers)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["subject"] == f"Vidit {body['label']}: Collections and approvals"
    assert "Collections and approvals" in preview["html"]
    assert "<li" in preview["html"]
    assert "* Approvals" in preview["text"]
    assert "/unsubscribe?token=" in preview["text"]
    assert preview["recipients"] >= 3
    assert preview["daily_cap"] == 2
    assert preview["days"] == -(-preview["recipients"] // 2)


def test_test_send_goes_to_the_admin_alone(make_user, outbox):
    admin = make_user(admin=True)
    make_user(consent=True)
    headers = login_as(client, admin)
    response = client.post(f"{_ADMIN}/test", json=_announcement(), headers=headers)
    assert response.status_code == 204, response.text
    [message] = outbox
    assert message.to == admin.email
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_test_send_refuses_an_unverified_admin(make_user, outbox):
    headers = login_as(client, make_user(admin=True, verified=False))
    response = client.post(f"{_ADMIN}/test", json=_announcement(), headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "email_unverified"
    assert outbox == []


def test_send_queues_only_opted_in_verified_live_analysts(db, make_user, outbox):
    admin = make_user(admin=True)
    reached = make_user(consent=True)
    unverified = make_user(consent=True, verified=False)
    no_consent = make_user()
    withdrawn = make_user(consent=True)
    erased = make_user(consent=True)
    db.query(ProductUpdateConsent).filter_by(user_id=withdrawn.id).update(
        {"withdrawn_at": datetime.now(UTC)}
    )
    db.query(User).filter_by(id=erased.id).update({"deleted_at": datetime.now(UTC)})
    db.commit()

    sent = _send(admin)

    # Queued only: nothing leaves inside the request.
    assert outbox == []
    recipients = {row.user_id for row in _deliveries(db, sent["id"])}
    assert reached.id in recipients
    assert recipients.isdisjoint({unverified.id, no_consent.id, withdrawn.id, erased.id})
    assert sent["recipient_count"] == len(recipients)
    assert sent["progress"]["queued"] == len(recipients)
    audit = db.query(AdminEvent).filter_by(actor_id=admin.id, action="product_update_sent").one()
    assert audit.target == {"label": sent["label"], "recipients": len(recipients)}


def test_a_label_is_sent_once(db, make_user):
    admin = make_user(admin=True)
    make_user(consent=True)
    sent = _send(admin)
    headers = login_as(client, admin)
    again = client.post(_ADMIN, json=_announcement(label=sent["label"]), headers=headers)
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "product_update_already_sent"
    assert db.query(ProductUpdate).filter_by(label=sent["label"]).count() == 1
    assert len(_deliveries(db, sent["id"])) == sent["recipient_count"]


# Worker drain


@pytest.fixture
def quiet_queue(db):
    """Park every other queued row and age every earlier send out of the cap
    window, so the drain and the cap see only this test's announcement."""
    db.query(ProductUpdateDelivery).filter(ProductUpdateDelivery.status == "queued").update(
        {"status": "skipped"}
    )
    db.query(ProductUpdateDelivery).filter(ProductUpdateDelivery.status == "sent").update(
        {"sent_at": datetime.now(UTC) - timedelta(days=2)}
    )
    db.commit()


def test_drain_sends_in_batches_under_the_daily_cap(
    db, make_user, outbox, monkeypatch, quiet_queue
):
    monkeypatch.setattr(settings, "product_update_email_batch_size", 2)
    monkeypatch.setattr(settings, "product_update_email_daily_cap", 3)
    admin = make_user(admin=True)
    recipients = {u.email: u for u in (make_user(consent=True) for _ in range(5))}
    sent = _send(admin)
    queued = sent["recipient_count"]

    assert product_updates.drain(db) == 2
    assert product_updates.drain(db) == 1
    assert product_updates.drain(db) == 0
    assert len(outbox) == 3

    statuses = [row.status for row in _deliveries(db, sent["id"])]
    assert statuses.count("sent") == 3
    assert statuses.count("queued") == queued - 3
    headers = login_as(client, admin)
    items = client.get(_ADMIN, headers=headers).json()["items"]
    [listed] = [item for item in items if item["id"] == sent["id"]]
    assert listed["progress"] == {
        "queued": queued - 3,
        "sending": 0,
        "sent": 3,
        "failed": 0,
        "skipped": 0,
    }

    message = next(m for m in outbox if m.to in recipients)
    token = unsubscribe_token(recipients[message.to].id)
    assert message.subject == f"Vidit {sent['label']}: Collections and approvals"
    assert message.headers["List-Unsubscribe"] == (
        f"<{settings.api_url}/product-updates/unsubscribe?token={token}>"
    )
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert f"{settings.frontend_url}/unsubscribe?token={token}" in message.text


def test_a_withdrawal_after_queueing_skips_the_row(db, make_user, outbox, quiet_queue):
    admin = make_user(admin=True)
    user = make_user(consent=True)
    sent = _send(admin)
    client.cookies.clear()
    client.post(_UNSUBSCRIBE, params={"token": unsubscribe_token(user.id)})

    product_updates.drain(db)

    assert user.email not in {m.to for m in outbox}
    [row] = [r for r in _deliveries(db, sent["id"]) if r.user_id == user.id]
    assert row.status == "skipped"


def test_a_stale_sending_row_fails_and_is_never_resent(db, make_user, outbox, quiet_queue):
    admin = make_user(admin=True)
    user = make_user(consent=True)
    sent = _send(admin)
    [row] = [r for r in _deliveries(db, sent["id"]) if r.user_id == user.id]
    row.status = "sending"
    row.claimed_at = datetime.now(UTC) - timedelta(hours=2)
    db.commit()

    product_updates.drain(db)

    db.refresh(row)
    assert row.status == "failed"
    assert user.email not in {m.to for m in outbox}


def test_a_row_that_raises_counts_as_a_refusal_and_the_batch_goes_on(
    db, make_user, outbox, monkeypatch, quiet_queue
):
    admin = make_user(admin=True)
    broken = make_user(consent=True)
    fine = make_user(consent=True)
    sent = _send(admin)
    build = product_updates._email_for

    def _flaky(**kwargs):
        if kwargs["to"] == broken.email:
            raise RuntimeError("template bug")
        return build(**kwargs)

    monkeypatch.setattr(product_updates, "_email_for", _flaky)

    product_updates.drain(db)

    rows = {r.user_id: r for r in _deliveries(db, sent["id"])}
    assert (rows[broken.id].status, rows[broken.id].attempts) == ("queued", 1)
    assert rows[fine.id].status == "sent"
    assert fine.email in {m.to for m in outbox}
