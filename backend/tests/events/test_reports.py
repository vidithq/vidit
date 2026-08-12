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

from app.models.content_report import ContentReport
from app.models.follow import Follow
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import WORLD_BBOX, _make_geo, client


@pytest.fixture
def admin_user(db):
    user = User(
        username=f"adm{uuid.uuid4().hex[:8]}",
        email=f"adm-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


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
    """The owner loses the detail read too: a takedown is not a private draft
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
    event can be neither closed nor investigated nor deleted while it stands."""
    hidden = _make_geo(db, author=author, hidden=True)
    headers = login_as(client, author)

    close = client.post(
        f"/api/v1/events/{hidden.id}/close",
        json={"close_reason": "changed my mind"},
        headers=headers,
    )
    assert close.status_code == 404
    assert client.delete(f"/api/v1/events/{hidden.id}", headers=headers).status_code == 404
