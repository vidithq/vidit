"""``POST /events/{id}/report`` and the takedown it can lead to.

Reporting is open to anonymous viewers (a takedown request must not require an
account), and a withheld event (``hidden_at``) drops off every public read the
way a soft-deleted one does, with the admin detail read as the one exception:
someone has to be able to see what was taken down. Shared fixtures live in
`conftest.py`; `client` / `_make_geo` in `_helpers.py`.
"""

from __future__ import annotations

import uuid

import pytest

from app.config import settings
from app.models.content_report import ContentReport
from app.models.follow import Follow
from app.services import email
from tests.conftest import login_as
from tests.events._helpers import WORLD_BBOX, _make_geo, client


@pytest.fixture
def email_recorder(monkeypatch):
    """Capture every ``email.send()`` call in order, like the auth suite."""
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    return sent


@pytest.fixture
def notify_address(monkeypatch):
    """Point the report notification at an address for the duration of a test.

    Unset is the shipped default, so the tests that assert a send have to opt
    in the same way an operator does.
    """
    address = "support@vidit.app"
    monkeypatch.setattr(settings, "report_notify_email", address)
    return address


# ── POST /events/{id}/report ──────────────────────────────────────────────


def test_anonymous_report_is_accepted(db, author):
    geo = _make_geo(db, author=author)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "illegal_content", "details": "Hosting this is unlawful."},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["event_id"] == str(geo.id)
    assert body["reason"] == "illegal_content"
    # No account behind it, and no verdict yet.
    assert body["reporter_user_id"] is None
    assert body["resolved_at"] is None
    assert body["resolution"] is None

    db.expire_all()
    row = db.query(ContentReport).filter(ContentReport.id == body["id"]).one()
    assert row.details == "Hosting this is unlawful."


def test_authenticated_report_records_the_reporter(db, author, second_user):
    geo = _make_geo(db, author=author)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "graphic_not_flagged"},
        headers=login_as(client, second_user),
    )
    assert response.status_code == 201, response.text
    assert response.json()["reporter_user_id"] == str(second_user.id)
    assert response.json()["details"] is None


def test_report_rejects_an_unknown_reason(db, author):
    geo = _make_geo(db, author=author)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "i-just-dont-like-it"},
    )
    assert response.status_code == 422


def test_report_rejects_over_long_details(db, author):
    geo = _make_geo(db, author=author)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "other", "details": "x" * 2001},
    )
    assert response.status_code == 422


def test_report_404_for_unknown_event(author):
    response = client.post(
        f"/api/v1/events/{uuid.uuid4()}/report",
        json={"reason": "other"},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "event_not_found"


def test_report_404_for_hidden_event(db, author):
    """A withheld event is invisible, so it cannot be reported again: the
    reporter gets the same 404 as for an id that never existed."""
    geo = _make_geo(db, author=author, hidden=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "other"},
    )
    assert response.status_code == 404


# ── The moderation notification ───────────────────────────────────────────


def test_notification_carries_the_report_for_an_anonymous_reporter(
    db, author, email_recorder, notify_address
):
    geo = _make_geo(db, author=author, title="Shelling on Market Street")
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "illegal_content", "details": "This footage is unlawful to host."},
    )
    assert response.status_code == 201, response.text

    assert len(email_recorder) == 1, "expected exactly one notification per report"
    message = email_recorder[0]
    assert message.to == notify_address
    assert "illegal_content" in message.subject
    text = message.text
    assert str(geo.id) in text
    assert "Shelling on Market Street" in text
    assert "illegal_content" in text
    assert "This footage is unlawful to host." in text
    # No account behind the report, so the operator is told so in as many words.
    assert "anonymous" in text
    assert response.json()["created_at"][:10] in text
    # Both ways in: the queue that resolves it, and the event it is about.
    assert f"{settings.frontend_url}/admin" in text
    assert f"{settings.frontend_url}/events/{geo.id}" in text


def test_notification_names_a_signed_in_reporter(
    db, author, second_user, email_recorder, notify_address
):
    geo = _make_geo(db, author=author)
    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "privacy"},
        headers=login_as(client, second_user),
    )
    assert response.status_code == 201, response.text

    assert len(email_recorder) == 1
    text = email_recorder[0].text
    assert second_user.username in text
    assert "anonymous" not in text
    # An absent ``details`` leaves the block out rather than printing "None".
    assert "None" not in text


def test_no_notification_when_no_address_is_configured(db, author, email_recorder, monkeypatch):
    """The shipped default sends nothing, and reporting is unaffected: the row
    is still written and still reaches the admin queue."""
    monkeypatch.setattr(settings, "report_notify_email", None)
    geo = _make_geo(db, author=author)

    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "other"},
    )
    assert response.status_code == 201, response.text
    assert email_recorder == []

    db.expire_all()
    assert db.query(ContentReport).filter(ContentReport.id == response.json()["id"]).one()


def test_report_survives_a_notification_send_failure(db, author, monkeypatch, notify_address):
    """The report is committed before the mail goes out, so a provider outage
    costs the heads-up, never the report."""

    def _boom(_message: email.Email) -> None:
        raise email.EmailSendError("simulated outage")

    monkeypatch.setattr(email, "send", _boom)
    geo = _make_geo(db, author=author)

    response = client.post(
        f"/api/v1/events/{geo.id}/report",
        json={"reason": "copyright"},
    )
    assert response.status_code == 201, response.text

    db.expire_all()
    stored = db.query(ContentReport).filter(ContentReport.id == response.json()["id"]).one()
    assert stored.reason == "copyright"


# ── Hidden events leave the public read surface ───────────────────────────


def test_hidden_event_absent_from_list_and_points(db, author):
    visible = _make_geo(db, author=author)
    hidden = _make_geo(db, author=author, hidden=True)

    listing = client.get("/api/v1/events")
    assert listing.status_code == 200
    ids = {row["id"] for row in listing.json()}
    assert str(visible.id) in ids
    assert str(hidden.id) not in ids

    points = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert points.status_code == 200
    # The map payload is compact tuples, id first.
    point_ids = {row[0] for row in points.json()}
    assert str(visible.id) in point_ids
    assert str(hidden.id) not in point_ids


def test_hidden_event_absent_from_search(db, author):
    token = f"takedownprobe{uuid.uuid4().hex[:8]}"
    visible = _make_geo(db, author=author, title=f"Visible {token} convoy")
    hidden = _make_geo(db, author=author, title=f"Withheld {token} convoy", hidden=True)

    response = client.get(f"/api/v1/search?q={token}")
    assert response.status_code == 200
    ids = {hit["id"] for hit in response.json()["geolocations"]}
    assert str(visible.id) in ids
    assert str(hidden.id) not in ids


def test_hidden_event_detail_is_404_for_everyone_but_an_admin(db, author, second_user, admin_user):
    """The owner loses the detail read too: a takedown is not a private detection
    state. An admin keeps it, since judging the report means seeing the row."""
    hidden = _make_geo(db, author=author, hidden=True)

    assert client.get(f"/api/v1/events/{hidden.id}").status_code == 404

    assert (
        client.get(f"/api/v1/events/{hidden.id}", headers=login_as(client, second_user)).status_code
        == 404
    )
    assert (
        client.get(f"/api/v1/events/{hidden.id}", headers=login_as(client, author)).status_code
        == 404
    )

    admin_read = client.get(f"/api/v1/events/{hidden.id}", headers=login_as(client, admin_user))
    assert admin_read.status_code == 200
    assert admin_read.json()["id"] == str(hidden.id)


def test_hidden_event_absent_from_the_profile_feed_and_count(db, author):
    visible = _make_geo(db, author=author)
    hidden = _make_geo(db, author=author, hidden=True)

    feed = client.get(f"/api/v1/users/{author.username}/events")
    assert feed.status_code == 200
    body = feed.json()
    ids = {row["id"] for row in body["items"]}
    assert str(visible.id) in ids
    assert str(hidden.id) not in ids
    assert body["total"] == 1

    profile = client.get(f"/api/v1/users/{author.username}")
    assert profile.json()["geolocations_count"] == 1


def test_hidden_event_absent_from_the_follow_timeline(db, author, second_user):
    visible = _make_geo(db, author=author)
    hidden = _make_geo(db, author=author, hidden=True)
    db.add(Follow(follower_id=second_user.id, followed_id=author.id))
    db.commit()

    response = client.get("/api/v1/timeline", headers=login_as(client, second_user))
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()["items"]}
    assert str(visible.id) in ids
    assert str(hidden.id) not in ids


def test_hidden_event_is_frozen_for_its_owner(db, author):
    """Every ``/{id}`` verb resolves through the same helper, so a withheld
    event can be neither closed nor investigated while it stands."""
    hidden = _make_geo(db, author=author, hidden=True)
    headers = login_as(client, author)

    close = client.post(
        f"/api/v1/events/{hidden.id}/close",
        json={"close_reason": "changed my mind"},
        headers=headers,
    )
    assert close.status_code == 404
