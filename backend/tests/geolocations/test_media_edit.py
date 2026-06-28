"""Source-media editing on a ``detected`` row, via the multipart ``POST .../submit``.

Submit is the only write to a detection: the form posts the whole state, new
media ride in ``files``, existing media are dropped via ``remove_media_ids``, all
applied in one atomic request that also flips the row to ``submitted``. So these
media mechanics are exercised through submit (with the tag floor met). Shared
fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` in ``_helpers.py``.
"""

from __future__ import annotations

import json
import uuid

from app.models.geolocation import STATUS_DETECTED, Geolocation
from app.models.media import Media
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.geolocations._helpers import _make_geo, client


def _detected(db, author, **kwargs):
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url="https://x.com/a/status/1",
        **kwargs,
    )


def _form(conflict_tag=None, capture_source_tag=None, **overrides):
    """The required full submit form; override per test. Pass both curated tags
    to meet the tag floor."""
    form = {
        "title": "Edited",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": "https://x.com/a/status/1",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
    }
    if conflict_tag is not None and capture_source_tag is not None:
        form["tag_ids"] = json.dumps([str(conflict_tag.id), str(capture_source_tag.id)])
    form.update(overrides)
    return form


def _jpeg():
    return {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}


def _submit(geo_id, author, **form_kwargs):
    return client.post(
        f"/api/v1/geolocations/{geo_id}/submit",
        headers=login_as(client, author),
        **form_kwargs,
    )


def test_submit_rolls_back_flip_when_media_upload_fails(
    db, author, conflict_tag, capture_source_tag
):
    # A file that clears the count floor but fails validation (disallowed MIME)
    # raises after the row was flipped to submitted in-memory. The whole
    # transaction rolls back, so the row stays detected and gains no media.
    geo = _detected(db, author)
    response = _submit(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag),
        files={"files": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"
    db.expire_all()
    refreshed = db.get(Geolocation, geo.id)
    assert refreshed.status == STATUS_DETECTED
    assert len(refreshed.media) == 0


def test_submit_adds_media(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author)  # born media-less
    response = _submit(geo.id, author, data=_form(conflict_tag, capture_source_tag), files=_jpeg())
    assert response.status_code == 200
    body = response.json()
    assert len(body["media"]) == 1
    assert body["media"][0]["media_type"] == "image"
    assert body["status"] == "submitted"
    db.expire_all()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 1


def test_submit_swaps_media_in_one_call(db, author, conflict_tag, capture_source_tag):
    """Drop the existing media and add a new one atomically (net still >=1, so
    the floor holds)."""
    geo = _detected(db, author, with_media=True)
    old_id = str(geo.media[0].id)
    response = _submit(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag, remove_media_ids=json.dumps([old_id])),
        files=_jpeg(),
    )
    assert response.status_code == 200
    media = response.json()["media"]
    assert len(media) == 1
    assert media[0]["id"] != old_id  # old one gone, a fresh one took its place


def test_submit_remove_to_zero_is_blocked(db, author, conflict_tag, capture_source_tag):
    """Removing the only media with no replacement leaves zero, which the
    evidence floor rejects (kept + new is what's counted). The floor check runs
    before any deletion, so the media survives."""
    geo = _detected(db, author, with_media=True)
    media_id = str(geo.media[0].id)
    response = _submit(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag, remove_media_ids=json.dumps([media_id])),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"
    db.expire_all()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 1


def test_submit_unknown_remove_id_is_ignored(db, author, conflict_tag, capture_source_tag):
    """A stale remove id (media already gone) is a no-op, not a hard failure; the
    existing media stays, so the floor still passes."""
    geo = _detected(db, author, with_media=True)
    response = _submit(
        geo.id,
        author,
        data=_form(
            conflict_tag, capture_source_tag, remove_media_ids=json.dumps([str(uuid.uuid4())])
        ),
    )
    assert response.status_code == 200
    assert len(response.json()["media"]) == 1  # untouched


def test_submit_rejects_over_cap(db, author):
    """The cap counts kept existing + new; 13 new files exceeds the 12 ceiling.
    The cap is checked before the floor, so no tags are needed to trip it."""
    geo = _detected(db, author)
    files = [("files", (f"t-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(13)]
    response = _submit(geo.id, author, data=_form(), files=files)
    assert response.status_code == 422
