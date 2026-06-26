"""Source-media editing on a ``detected`` row — via the multipart ``PATCH``.

The owner edits a detection like a submit: the form posts the whole state, new
media ride in ``files``, existing media are dropped via ``remove_media_ids``, all
applied in one atomic request. Shared fixtures live in ``conftest.py``;
``client`` / ``_make_geo`` in ``_helpers.py``.
"""

from __future__ import annotations

import json
import uuid

from app.models.geolocation import STATE_DETECTED
from app.models.media import Media
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.geolocations._helpers import _make_geo, client


def _detected(db, author, **kwargs):
    return _make_geo(
        db,
        author=author,
        state=STATE_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url="https://x.com/a/status/1",
        **kwargs,
    )


def _form(**overrides):
    """The required full-edit form fields; override per test."""
    form = {
        "title": "Edited",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": "https://x.com/a/status/1",
        "event_date": "2026-05-01",
    }
    form.update(overrides)
    return form


def _jpeg():
    return {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}


def test_patch_adds_media(db, author):
    geo = _detected(db, author)  # born media-less
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_form(),
        files=_jpeg(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["media"]) == 1
    assert body["media"][0]["media_type"] == "image"
    db.expire_all()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 1


def test_patch_removes_media(db, author):
    geo = _detected(db, author, with_media=True)
    media_id = str(geo.media[0].id)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_form(remove_media_ids=json.dumps([media_id])),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    assert response.json()["media"] == []
    db.expire_all()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 0


def test_patch_swaps_media_in_one_call(db, author):
    """Drop the existing media and add a new one atomically."""
    geo = _detected(db, author, with_media=True)
    old_id = str(geo.media[0].id)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_form(remove_media_ids=json.dumps([old_id])),
        files=_jpeg(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    media = response.json()["media"]
    assert len(media) == 1
    assert media[0]["id"] != old_id  # old one gone, a fresh one took its place


def test_patch_unknown_remove_id_is_ignored(db, author):
    """A stale remove id (media already gone) is a no-op, not a hard failure."""
    geo = _detected(db, author, with_media=True)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_form(remove_media_ids=json.dumps([str(uuid.uuid4())])),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    assert len(response.json()["media"]) == 1  # untouched


def test_patch_rejects_over_cap(db, author):
    """The cap counts kept existing + new; 13 new files exceeds the 12 ceiling."""
    geo = _detected(db, author)
    files = [("files", (f"t-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(13)]
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_form(),
        files=files,
        headers=login_as(client, author),
    )
    assert response.status_code == 422
