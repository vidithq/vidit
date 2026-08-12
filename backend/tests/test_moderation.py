"""The admin side of content reports: the queue, the verdicts, the overrides.

``GET /admin/reports`` reads open reports first, ``POST
/admin/reports/{id}/resolve`` closes one with a verdict that may mutate the
event, and ``PATCH /admin/events/{id}/moderation`` moves the same two fields
with no report behind it. Every mutation leaves an ``admin_events`` row, which
is what these tests pin alongside the state changes.
"""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.content_report import ContentReport
from app.models.event import Event
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_test_client_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def admin_user(db):
    user = User(
        username=f"mod{uuid.uuid4().hex[:8]}",
        email=f"mod-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    # Reap this actor's audit rows so the user row deletes cleanly, the same
    # teardown shape as the admin suite.
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def regular_user(db):
    user = User(
        username=f"usr{uuid.uuid4().hex[:8]}",
        email=f"usr-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def event(db, regular_user):
    row = Event(
        owner_id=regular_user.id,
        title=f"Moderated {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        geolocated_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _report(db, event, *, reason: str = "other", resolved: bool = False) -> ContentReport:
    row = ContentReport(event_id=event.id, reason=reason)
    if resolved:
        row.resolved_at = datetime.now(UTC)
        row.resolution = "dismissed"
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _audit(db, admin_user, action: str) -> AdminEvent | None:
    return (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == action)
        .order_by(AdminEvent.created_at.desc())
        .first()
    )


# ── GET /admin/reports ────────────────────────────────────────────────────


def test_queue_lists_open_reports_before_resolved_ones(db, admin_user, event):
    resolved = _report(db, event, resolved=True)
    still_open = _report(db, event)

    response = client.get("/api/v1/admin/reports", headers=login_as(client, admin_user))
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["items"]]
    assert ids.index(str(still_open.id)) < ids.index(str(resolved.id))


def test_queue_403_for_regular_user(regular_user):
    response = client.get("/api/v1/admin/reports", headers=login_as(client, regular_user))
    assert response.status_code == 403


# ── POST /admin/reports/{id}/resolve ──────────────────────────────────────


def test_resolve_marked_graphic_sets_the_flag_and_stamps_the_report(db, admin_user, event):
    report = _report(db, event, reason="graphic_not_flagged")

    response = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "marked_graphic"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resolution"] == "marked_graphic"
    assert body["resolved_at"] is not None
    assert body["resolved_by"] == str(admin_user.id)

    db.expire_all()
    assert db.query(Event).filter(Event.id == event.id).one().is_graphic is True

    assert _audit(db, admin_user, "report_resolved").target == {
        "report_id": str(report.id),
        "event_id": str(event.id),
        "resolution": "marked_graphic",
    }
    assert _audit(db, admin_user, "event_marked_graphic").target == {"event_id": str(event.id)}


def test_resolve_hidden_takes_the_event_off_the_public_list(db, admin_user, event):
    report = _report(db, event, reason="illegal_content")
    before = client.get("/api/v1/events")
    assert str(event.id) in {row["id"] for row in before.json()}

    response = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "hidden"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(Event).filter(Event.id == event.id).one().hidden_at is not None

    after = client.get("/api/v1/events")
    assert str(event.id) not in {row["id"] for row in after.json()}
    assert _audit(db, admin_user, "event_hidden").target == {"event_id": str(event.id)}


def test_resolve_dismissed_leaves_the_event_untouched(db, admin_user, event):
    report = _report(db, event)

    response = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "dismissed"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    refreshed = db.query(Event).filter(Event.id == event.id).one()
    assert refreshed.is_graphic is False
    assert refreshed.hidden_at is None
    # The verdict is still an administrative act, so it is still audited.
    assert _audit(db, admin_user, "report_resolved") is not None
    assert _audit(db, admin_user, "event_hidden") is None


def test_resolving_twice_is_a_conflict(db, admin_user, event):
    report = _report(db, event)
    headers = login_as(client, admin_user)
    first = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "dismissed"},
        headers=headers,
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "hidden"},
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "report_already_resolved"

    db.expire_all()
    # The first verdict stands and the event never moved.
    assert db.query(ContentReport).filter(ContentReport.id == report.id).one().resolution == (
        "dismissed"
    )
    assert db.query(Event).filter(Event.id == event.id).one().hidden_at is None


def test_resolve_404_for_unknown_report(admin_user):
    response = client.post(
        f"/api/v1/admin/reports/{uuid.uuid4()}/resolve",
        json={"resolution": "dismissed"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "report_not_found"


def test_resolve_403_for_regular_user(db, regular_user, event):
    report = _report(db, event)
    response = client.post(
        f"/api/v1/admin/reports/{report.id}/resolve",
        json={"resolution": "dismissed"},
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


# ── PATCH /admin/events/{id}/moderation ───────────────────────────────────


def test_moderation_hides_then_restores_the_event(db, admin_user, event):
    headers = login_as(client, admin_user)

    hide = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"hidden": True},
        headers=headers,
    )
    assert hide.status_code == 200, hide.text
    assert hide.json()["hidden_at"] is not None
    assert str(event.id) not in {row["id"] for row in client.get("/api/v1/events").json()}
    assert _audit(db, admin_user, "event_hidden").target == {"event_id": str(event.id)}

    restore = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"hidden": False},
        headers=headers,
    )
    assert restore.status_code == 200, restore.text
    assert restore.json()["hidden_at"] is None
    assert str(event.id) in {row["id"] for row in client.get("/api/v1/events").json()}
    assert _audit(db, admin_user, "event_unhidden").target == {"event_id": str(event.id)}

    db.expire_all()
    assert db.query(Event).filter(Event.id == event.id).one().hidden_at is None


def test_moderation_overrides_the_graphic_flag_both_ways(db, admin_user, event):
    headers = login_as(client, admin_user)

    marked = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"is_graphic": True},
        headers=headers,
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["is_graphic"] is True
    assert _audit(db, admin_user, "event_marked_graphic") is not None

    cleared = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"is_graphic": False},
        headers=headers,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["is_graphic"] is False
    assert _audit(db, admin_user, "event_unmarked_graphic") is not None

    db.expire_all()
    assert db.query(Event).filter(Event.id == event.id).one().is_graphic is False


def test_moderation_no_op_writes_no_audit_row(db, admin_user, event):
    """Re-sending the state the row already holds is not an administrative
    act, so the trail stays a record of actual changes."""
    response = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"is_graphic": False, "hidden": False},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(AdminEvent).filter(AdminEvent.actor_id == admin_user.id).count() == 0, (
        "a no-op moderation call wrote an audit row"
    )


def test_moderation_404_for_unknown_event(admin_user):
    response = client.patch(
        f"/api/v1/admin/events/{uuid.uuid4()}/moderation",
        json={"hidden": True},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "event_not_found"


def test_moderation_403_for_regular_user(regular_user, event):
    response = client.patch(
        f"/api/v1/admin/events/{event.id}/moderation",
        json={"hidden": True},
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403
