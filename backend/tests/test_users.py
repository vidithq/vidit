"""End-to-end tests for `/users/{username}` + `/users/{username}/events`
plus `PATCH /users/me` (self-edit of bio / links) and the avatar endpoints.

Contracts:

* Soft-deleted users 404 like unknown ones, so removal is no existence oracle.
* The profile feed counts and lists only published geolocations (live and
  `status = 'geolocated'`) with the same filter, so the pager never counts
  unserved rows. `geolocations_count` counts the same set (the Insights card's
  Geolocated tile). `GET /users/{u}/stats` reports the documented work: the
  three worked statuses minus withdrawn requests, summed as `total_events`.
* `UserProfile` carries bio, avatar_url and external_links, never `email`.
* `PATCH /users/me` distinguishes an omitted field (preserved) from null or
  empty (cleared).
* `avatar_url` is server-minted: a typed URL would be fetched by every viewer's
  browser (a beacon). `PUT /users/me/avatar` stores one image on our media host,
  `DELETE` clears both, and the self-edit body cannot set it.
"""

from __future__ import annotations

import uuid
from datetime import date
from io import BytesIO

import pytest
from PIL import Image

from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_REQUESTED,
)
from app.models.user import User
from app.services.evidence_processing import (
    MAX_AVATAR_DECODED_PIXELS,
    MAX_DECODED_PIXELS,
    UNREADABLE_IMAGE_MESSAGE,
)
from app.services.storage import LOCAL_STORAGE_URL_PREFIX
from tests._fixtures import TINY_JPEG, client, gif_bytes, make_event, storage_key, stored_path
from tests.conftest import login_as

# ── GET /users/{username} — profile ───────────────────────────────────────


def test_profile_returns_user_shape(live_user):
    response = client.get(f"/api/v1/users/{live_user.username}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(live_user.id)
    assert body["username"] == live_user.username
    assert body["bio"] is None
    assert body["avatar_url"] is None
    # Defaults to ``{}``, never NULL.
    assert body["external_links"] == {}
    assert body["geolocations_count"] == 0
    # ``UserProfile`` is public: an email here would be a harvest endpoint.
    assert "email" not in body


@pytest.mark.parametrize("page", ["", "/events", "/stats", "/collections"])
@pytest.mark.parametrize("who", ["unknown", "soft-deleted"])
def test_user_pages_404_for_an_unknown_or_soft_deleted_user(soft_deleted_user, page, who):
    """Same 404 for both: any distinguishable answer would reveal removed usernames."""
    username = soft_deleted_user.username if who == "soft-deleted" else f"nobody-{uuid.uuid4().hex}"
    assert client.get(f"/api/v1/users/{username}{page}").status_code == 404


def test_feed_returns_pagination_envelope(live_user):
    response = client.get(f"/api/v1/users/{live_user.username}/events")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["per_page"] == 20


def test_feed_serves_published_work_only(db, live_user):
    """The portfolio lists only what the analyst vouched for: not a `detected` row
    (unvouched machine output), a closed-off detection, or a `requested` row.
    Detections stay reachable from the owner's queue and the coverage map."""
    published = make_event(db, author=live_user, title="published")
    detection = make_event(db, author=live_user, title="detection", status=STATUS_DETECTED)
    rejected = make_event(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )
    request = make_event(db, author=live_user, title="request", status=STATUS_REQUESTED)
    removed = make_event(db, author=live_user, title="removed", deleted=True)

    body = client.get(f"/api/v1/users/{live_user.username}/events").json()

    assert [row["id"] for row in body["items"]] == [str(published.id)]
    excluded = {str(detection.id), str(rejected.id), str(request.id), str(removed.id)}
    assert excluded.isdisjoint({row["id"] for row in body["items"]})
    # `total` must not count rows the feed never serves (a "Show more" to nowhere).
    assert body["total"] == 1


def test_profile_count_counts_published_work_only(db, live_user):
    """`geolocations_count` counts published geolocations only, across the lifecycle.

    An archive import leaves hundreds of machine detections; counting them would
    credit the analyst with claims they never made.
    """
    make_event(db, author=live_user, title="published")
    make_event(db, author=live_user, title="detection", status=STATUS_DETECTED)
    make_event(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )
    make_event(db, author=live_user, title="request", status=STATUS_REQUESTED)
    make_event(
        db,
        author=live_user,
        title="withdrawn",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
    )
    make_event(db, author=live_user, title="removed", deleted=True)

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    feed = client.get(f"/api/v1/users/{live_user.username}/events").json()
    assert profile["geolocations_count"] == feed["total"] == 1


def test_profile_count_and_stats_report_different_numbers(db, live_user):
    """`/stats` splits by status and sums to `total_events`; the profile counts the
    published part. Collapsing the two would drop the wider figure."""
    make_event(db, author=live_user)
    make_event(db, author=live_user, status=STATUS_DETECTED)
    make_event(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    stats = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert profile["geolocations_count"] == 1
    assert stats["geolocated_count"] == 1
    assert stats["detected_count"] == 1
    assert stats["total_events"] == 2


def test_feed_orders_published_rows_newest_event_date_first(db, live_user):
    """Order applies to the filtered set: a detection dated between two published rows takes no page slot."""
    make_event(db, author=live_user, occurred_date=date(2025, 1, 1), title="old")
    make_event(db, author=live_user, occurred_date=date(2026, 12, 1), title="new")
    make_event(db, author=live_user, occurred_date=date(2026, 6, 1), title="mid")
    make_event(
        db,
        author=live_user,
        occurred_date=date(2026, 9, 1),
        title="detection",
        status=STATUS_DETECTED,
    )

    body = client.get(f"/api/v1/users/{live_user.username}/events?per_page=2").json()
    assert [row["title"] for row in body["items"]] == ["new", "mid"]
    assert body["total"] == 3


def test_feed_caps_per_page_at_100(db, live_user):
    """The server caps `per_page` at 100, whatever is requested."""
    response = client.get(f"/api/v1/users/{live_user.username}/events?per_page=500")
    assert response.status_code == 200
    assert response.json()["per_page"] == 100


def test_patch_me_requires_auth():
    response = client.patch("/api/v1/users/me", json={"bio": "anything"})
    assert response.status_code == 401


def test_patch_me_sets_bio(live_user, db):
    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "OSINT analyst, Eastern Ukraine armoured movement."},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    assert response.json()["bio"] == "OSINT analyst, Eastern Ukraine armoured movement."

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "OSINT analyst, Eastern Ukraine armoured movement."


def test_patch_me_replaces_external_links_wholesale(live_user, db):
    """The JSONB column is replaced, not deep-merged: clearing a field and re-saving
    drops it, and the handler filters nulls out of the stored object."""
    client.patch(
        "/api/v1/users/me",
        json={"external_links": {"x": "@me", "github": "@me-gh"}},
        headers=login_as(client, live_user),
    )

    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {"github": "@me-gh-2"}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.external_links == {"github": "me-gh-2"}


@pytest.mark.parametrize(
    ("field", "sent", "stored"),
    [
        ("x", "@ana", "ana"),
        ("x", "ana", "ana"),
        ("x", "https://x.com/ana", "ana"),
        ("x", "https://twitter.com/ana/", "ana"),
        ("x", "https://mobile.twitter.com/ana", "ana"),
        ("x", "https://www.x.com/ana", "ana"),
        ("github", "https://github.com/vidithq", "vidithq"),
        ("github", "@vidit-hq", "vidit-hq"),
        ("discord", "@ana", "ana"),
        ("discord", "ana#1234", "ana#1234"),
    ],
)
def test_patch_me_stores_the_handle_alone(live_user, db, field, sent, stored):
    """Both accepted forms are stored as the bare handle, so readers print the name
    without parsing a URL and link it without trusting the typed host."""
    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {field: sent}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    assert response.json()["external_links"] == {field: stored}

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.external_links == {field: stored}


@pytest.mark.parametrize(
    ("field", "sent"),
    [
        # A post is not an account, and neither is a product path.
        ("x", "https://x.com/ana/status/1"),
        ("x", "https://x.com/i/flow"),
        # A mirror host the platform does not own.
        ("x", "https://evil.example/ana"),
        # Neither a handle nor a URL.
        ("x", "x.com/ana"),
        ("x", "some user"),
        ("x", "sixteencharacters"),
        ("github", "https://github.com/orgs/vidithq/people"),
        ("discord", "https://discord.gg/abc"),
        ("discord", "ana/1234"),
    ],
)
def test_patch_me_rejects_a_value_that_is_not_an_account(live_user, field, sent):
    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {field: sent}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def test_patch_me_omitted_fields_preserved(live_user, db):
    """Omitting a field leaves the column alone — distinct from sending null."""
    live_user.bio = "seeded bio"
    live_user.external_links = {"x": "@seeded"}
    db.commit()

    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {"x": "@edited"}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "seeded bio"
    assert refreshed.external_links == {"x": "edited"}


def test_patch_me_empty_string_clears_bio(live_user, db):
    """Submitting "" clears the bio: the schema strips whitespace and coerces empty to None."""
    live_user.bio = "seeded"
    db.commit()

    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "   "},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    assert response.json()["bio"] is None

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio is None


@pytest.mark.parametrize(
    "body", [{"avatar_url": "https://tracker.example.com/beacon.gif"}, {"is_admin": True}]
)
def test_patch_me_refuses_a_field_outside_the_self_edit(live_user, db, body):
    """The self-edit body is ``extra=forbid`` and has no ``avatar_url``: the column may only
    hold a server-minted URL (a writable field is a beacon)."""
    response = client.patch("/api/v1/users/me", json=body, headers=login_as(client, live_user))
    assert response.status_code == 422

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None
    assert refreshed.is_admin is False


def test_patch_me_rejects_overlong_bio(live_user):
    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "x" * 501},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def _put_avatar(live_user, content: bytes = TINY_JPEG, content_type: str = "image/jpeg"):
    return client.put(
        "/api/v1/users/me/avatar",
        files={"file": ("me.jpg", content, content_type)},
        headers=login_as(client, live_user),
    )


def test_put_avatar_stores_the_image_on_our_own_host(live_user, db):
    """The minted URL is under our storage prefix, never an owner-chosen host."""
    response = _put_avatar(live_user)
    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url.startswith(f"{LOCAL_STORAGE_URL_PREFIX}/avatars/{live_user.id}/")
    assert url.endswith(".jpg")
    # One object, not the hero/thumb trio.
    stored = stored_path(storage_key(url))
    assert stored.is_file()
    assert list(stored.parent.iterdir()) == [stored]

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url == url


def test_put_avatar_replaces_and_removes_the_previous_object(live_user, db):
    """A replaced picture is deleted, or its old URL keeps working."""
    first_url = _put_avatar(live_user).json()["avatar_url"]
    first_path = stored_path(storage_key(first_url))
    assert first_path.is_file()

    second_url = _put_avatar(live_user).json()["avatar_url"]
    assert second_url != first_url
    assert not first_path.exists()
    assert stored_path(storage_key(second_url)).is_file()

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url == second_url


def test_delete_avatar_clears_the_column_and_the_object(live_user, db):
    url = _put_avatar(live_user).json()["avatar_url"]
    stored = stored_path(storage_key(url))
    assert stored.is_file()

    response = client.delete("/api/v1/users/me/avatar", headers=login_as(client, live_user))
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert not stored.exists()

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None


def test_delete_avatar_is_idempotent(live_user):
    """Nothing to clear is a success, so a double-click can't 500."""
    response = client.delete("/api/v1/users/me/avatar", headers=login_as(client, live_user))
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"not an image at all", "text/plain"),
        (b"\x00\x00\x00\x18ftypmp42", "video/mp4"),
        (gif_bytes(1), "image/gif"),
    ],
)
def test_put_avatar_rejects_non_images(live_user, db, content, content_type):
    """Only the image types the evidence pipeline accepts can become an avatar:
    a video would land unstripped and unresized."""
    response = _put_avatar(live_user, content=content, content_type=content_type)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_avatar"

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None


def test_put_avatar_rejects_undecodable_image(live_user):
    """A JPEG content type on bytes Pillow can't open is a 422, not a 500."""
    response = _put_avatar(live_user, content=b"\xff\xd8\xff\xd9", content_type="image/jpeg")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_avatar"


def test_put_avatar_accepts_a_webp_declared_as_jpeg(live_user):
    """The declared type does not pick the decoder: a WebP sent as
    ``image/jpeg`` becomes an avatar like any accepted image."""
    buf = BytesIO()
    Image.new("RGB", (8, 8), "green").save(buf, format="WEBP")

    response = _put_avatar(live_user, content=buf.getvalue(), content_type="image/jpeg")

    assert response.status_code == 200
    stored = stored_path(storage_key(response.json()["avatar_url"]))
    assert stored.read_bytes().startswith(b"\xff\xd8\xff")


def test_put_avatar_names_the_accepted_formats_when_refusing_one(live_user):
    buf = BytesIO()
    Image.new("RGB", (8, 8)).save(buf, format="TIFF")

    response = _put_avatar(live_user, content=buf.getvalue(), content_type="image/png")

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_avatar",
        "message": UNREADABLE_IMAGE_MESSAGE,
    }


def test_put_avatar_rejects_an_image_over_the_avatar_pixel_cap(live_user, db):
    """An avatar has a lower pixel ceiling than evidence: refused, nothing stored."""
    width, height = MAX_AVATAR_DECODED_PIXELS // 5000 + 1, 5000
    assert width * height <= MAX_DECODED_PIXELS
    buf = BytesIO()
    Image.new("L", (width, height)).save(buf, format="PNG")

    response = _put_avatar(live_user, content=buf.getvalue(), content_type="image/png")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_avatar"
    assert not stored_path("avatars").exists()
    db.expire_all()
    assert db.query(User).filter(User.id == live_user.id).one().avatar_url is None


def test_avatar_endpoints_require_auth():
    assert (
        client.put("/api/v1/users/me/avatar", files={"file": ("me.jpg", TINY_JPEG)}).status_code
        == 401
    )
    assert client.delete("/api/v1/users/me/avatar").status_code == 401


def test_my_x_handle_reads_the_handle_an_admin_bound(db, live_user):
    login_as(client, live_user)
    assert client.get("/api/v1/users/me/x-handle").json() == {"x_handle": None}
    live_user.x_handle = f"h_{uuid.uuid4().hex[:8]}"
    db.commit()
    assert client.get("/api/v1/users/me/x-handle").json() == {"x_handle": live_user.x_handle}
    client.cookies.clear()
    assert client.get("/api/v1/users/me/x-handle").status_code == 401
