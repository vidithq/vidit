"""The author-set ``is_graphic`` flag.

It ratchets on edit (only admin moderation clears it) and both read payloads carry it.
"""

from __future__ import annotations

import json

from app.models.event import STATUS_DETECTED, Event
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)


def _create_form(conflict, capture_source_tag, **overrides):
    form = {
        "title": "Graphic flag probe",
        "lat": "0.0",
        "lng": "0.0",
        "source_url": "https://example.com/source",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
    }
    form.update(overrides)
    return form


def _create_files():
    return [("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part()]


def _geolocate_form(conflict, capture_source_tag, **overrides):
    form = {
        "title": "Edited title",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": "https://x.com/a/status/1",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
    }
    form.update(overrides)
    return form


def test_create_defaults_to_not_graphic(db, author, conflict, capture_source_tag):
    """A form that omits the field submits an unflagged event."""
    response = client.post(
        "/api/v1/events",
        data=_create_form(conflict, capture_source_tag),
        files=_create_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_graphic"] is False

    db.expire_all()
    row = db.query(Event).filter(Event.id == response.json()["id"]).one()
    assert row.is_graphic is False


def test_create_records_the_declared_flag(db, author, conflict, capture_source_tag):
    response = client.post(
        "/api/v1/events",
        data=_create_form(conflict, capture_source_tag, is_graphic="true"),
        files=_create_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_graphic"] is True

    db.expire_all()
    row = db.query(Event).filter(Event.id == response.json()["id"]).one()
    assert row.is_graphic is True


def test_request_records_the_declared_flag(db, author):
    """A request declares the flag on the same terms as a direct submit."""
    response = client.post(
        "/api/v1/events/requests",
        data={
            "title": "Graphic request",
            "source_url": "https://example.com/source",
            "source_posted_at": "2026-05-01T12:00",
            "is_graphic": "true",
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
        headers=login_as(client, author),
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_graphic"] is True


def test_geolocate_sets_the_flag(db, author, conflict, capture_source_tag):
    geo = _make_geo(
        db, author=author, status=STATUS_DETECTED, with_media=True, detected_from_url="https://x/1"
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(conflict, capture_source_tag, is_graphic="true"),
        files=[proof_file_part()],
        headers=login_as(client, author),
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True

    db.expire_all()
    assert db.query(Event).filter(Event.id == geo.id).one().is_graphic is True


def test_geolocate_cannot_clear_the_flag(db, author, conflict, capture_source_tag):
    """An omitted box leaves a flag the detection already carried, unlike every other form field."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        with_media=True,
        is_graphic=True,
        detected_from_url="https://x/2",
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(conflict, capture_source_tag),
        files=[proof_file_part()],
        headers=login_as(client, author),
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True

    db.expire_all()
    assert db.query(Event).filter(Event.id == geo.id).one().is_graphic is True


def test_admin_can_still_unmark_a_ratcheted_flag(
    db, author, admin_user, conflict, capture_source_tag
):
    """An admin unmark clears a flag the form cannot."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        with_media=True,
        is_graphic=True,
        detected_from_url="https://x/3",
    )
    edit = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(conflict, capture_source_tag),
        files=[proof_file_part()],
        headers=login_as(client, author),
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["is_graphic"] is True

    unmark = client.patch(
        f"/api/v1/admin/events/{geo.id}/moderation",
        json={"is_graphic": False},
        headers=login_as(client, admin_user),
    )
    assert unmark.status_code == 200, unmark.text
    assert unmark.json()["is_graphic"] is False

    db.expire_all()
    assert db.query(Event).filter(Event.id == geo.id).one().is_graphic is False


def test_flag_travels_on_the_list_and_detail_payloads(db, author):
    """Both read shapes carry the flag, so no second request is needed."""
    graphic = _make_geo(db, author=author, is_graphic=True)
    plain = _make_geo(db, author=author)

    listing = client.get("/api/v1/events")
    assert listing.status_code == 200
    by_id = {row["id"]: row for row in listing.json()}
    assert by_id[str(graphic.id)]["is_graphic"] is True
    assert by_id[str(plain.id)]["is_graphic"] is False

    detail = client.get(f"/api/v1/events/{graphic.id}")
    assert detail.status_code == 200
    assert detail.json()["is_graphic"] is True
