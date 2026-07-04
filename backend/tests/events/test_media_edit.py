"""Source-media editing on a ``detected`` row, via the multipart ``POST .../geolocate``.

Geolocate is the only write to a detection: the form posts the whole state, a
replacement source rides in ``files``, existing media are dropped via
``remove_media_ids``, proof images in ``proof_files``, all applied in one
atomic request that also flips the row to ``geolocated``. So these media
mechanics are exercised through geolocate (with the tag + proof floor met).
Shared fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` / the
proof helpers in ``_helpers.py``.
"""

from __future__ import annotations

import io
import json
import uuid

import pytest
from fastapi import UploadFile

from app.models.event import STATUS_DETECTED, Event
from app.models.media import Media
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)


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
    """The required full geolocate form; override per test. Pass both curated
    tags to meet the tag floor (the proof-image floor is included)."""
    form = {
        "title": "Edited",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": "https://x.com/a/status/1",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
    }
    if conflict_tag is not None and capture_source_tag is not None:
        form["tag_ids"] = json.dumps([str(conflict_tag.id), str(capture_source_tag.id)])
    form.update(overrides)
    return form


def _source_part():
    return ("files", ("tiny.jpg", TINY_JPEG, "image/jpeg"))


def _geolocate(geo_id, author, **kwargs):
    return client.post(
        f"/api/v1/events/{geo_id}/geolocate",
        headers=login_as(client, author),
        **kwargs,
    )


def test_geolocate_rolls_back_flip_when_media_upload_fails(
    db, author, conflict_tag, capture_source_tag
):
    # A file that clears the count floor but fails validation (disallowed MIME)
    # raises after the row was flipped to geolocated in-memory. The whole
    # transaction rolls back, so the row stays detected and gains no media.
    geo = _detected(db, author)
    response = _geolocate(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag),
        files=[("files", ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")), proof_file_part()],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"
    db.expire_all()
    refreshed = db.get(Event, geo.id)
    assert refreshed.status == STATUS_DETECTED
    assert len(refreshed.media) == 0


def test_geolocate_adds_source_media(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author)  # born media-less
    response = _geolocate(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag),
        files=[_source_part(), proof_file_part()],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["media"]) == 1
    assert body["media"][0]["media_type"] == "image"
    assert body["media"][0]["role"] == "source"
    assert body["status"] == "geolocated"
    db.expire_all()
    # One source + the resolved proof image.
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "source").count() == 1
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").count() == 1


def test_geolocate_swaps_source_in_one_call(db, author, conflict_tag, capture_source_tag):
    """Drop the existing source and add a new one atomically (net still exactly
    one, so both the floor and the one-source cap hold, the deletes flush
    before the insert, or the partial unique index would trip mid-flush)."""
    geo = _detected(db, author, with_media=True)
    old_id = str(geo.media[0].id)
    response = _geolocate(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag, remove_media_ids=json.dumps([old_id])),
        files=[_source_part(), proof_file_part()],
    )
    assert response.status_code == 200, response.text
    media = response.json()["media"]
    assert len(media) == 1
    assert media[0]["id"] != old_id  # old one gone, a fresh one took its place


def test_geolocate_remove_to_zero_is_blocked(db, author, conflict_tag, capture_source_tag):
    """Removing the only source with no replacement leaves zero, which the
    evidence floor rejects (kept + new is what's counted). The floor check runs
    before any deletion, so the media survives."""
    geo = _detected(db, author, with_media=True)
    media_id = str(geo.media[0].id)
    response = _geolocate(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag, remove_media_ids=json.dumps([media_id])),
        files=[proof_file_part()],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"
    db.expire_all()
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 1


def test_geolocate_unknown_remove_id_is_ignored(db, author, conflict_tag, capture_source_tag):
    """A stale remove id (media already gone) is a no-op, not a hard failure; the
    existing source stays, so the floor still passes."""
    geo = _detected(db, author, with_media=True)
    response = _geolocate(
        geo.id,
        author,
        data=_form(
            conflict_tag, capture_source_tag, remove_media_ids=json.dumps([str(uuid.uuid4())])
        ),
        files=[proof_file_part()],
    )
    assert response.status_code == 200
    assert len(response.json()["media"]) == 1  # untouched


def test_geolocate_rejects_second_source(db, author):
    """The cap counts kept existing + new: a second source file on top of the
    kept one exceeds the one-source-per-event ceiling. The cap is checked
    before the floor, so no tags are needed to trip it."""
    geo = _detected(db, author, with_media=True)
    response = _geolocate(geo.id, author, data=_form(), files=[_source_part()])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "too_many_files"


def test_geolocate_drops_stale_proof_media(db, author, conflict_tag, capture_source_tag):
    """A proof image the incoming doc no longer references is deleted (row +
    S3), so edits can't accrete orphaned proof rows."""
    geo = _detected(db, author, with_media=True)
    stale = Media(
        event_id=geo.id,
        role="proof",
        storage_url="http://localhost:8000/local-storage/proof/u/stale.jpg",
        media_type="image",
    )
    db.add(stale)
    db.commit()
    stale_id = stale.id

    response = _geolocate(
        geo.id,
        author,
        data=_form(conflict_tag, capture_source_tag),
        files=[proof_file_part()],
    )
    assert response.status_code == 200, response.text
    db.expire_all()
    proof_rows = db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").all()
    assert stale_id not in {m.id for m in proof_rows}
    assert len(proof_rows) == 1  # the freshly-resolved placeholder image


async def test_second_source_insert_races_to_409_not_500(db, author, tmp_path, monkeypatch):
    """Two writers race the one-source cap: this writer's count check passed on
    a snapshot with no source, then the competing writer's row committed first.
    The ``uq_media_source_per_event`` partial unique index is the DB backstop;
    its ``IntegrityError`` must surface as the 409-shaped
    ``source_media_conflict`` (not a 500), roll the transaction back, and sweep
    the loser's uploaded object. Service-level on purpose: over HTTP the
    geolocate row lock serialises the writers, so the index branch can't be
    reached deterministically through the endpoint.
    """
    from app.routers.events._common import _EVENT_ERROR_STATUS
    from app.services import storage as storage_module
    from app.services.evidence_intake import (
        SourceMediaConflictError,
        attach_evidence_and_commit,
    )

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    geo = _detected(db, author)  # born media-less: the count check saw zero
    # The competing writer wins the race: its source row is already committed.
    winner_url = "http://localhost:8000/local-storage/uploads/w/winner.jpg"
    db.add(Media(event_id=geo.id, role="source", storage_url=winner_url, media_type="image"))
    db.commit()

    loser = UploadFile(
        filename="loser.jpg",
        file=io.BytesIO(TINY_JPEG),
        headers={"content-type": "image/jpeg"},  # type: ignore[arg-type]
    )
    with pytest.raises(SourceMediaConflictError) as excinfo:
        await attach_evidence_and_commit(
            db,
            event=geo,
            source_files=[loser],
            proof_doc=None,
            proof_files=[],
            sweep_context="race test",
        )
    # The typed code the events routers map to 409 (the review-locked contract).
    assert excinfo.value.code == "source_media_conflict"
    assert _EVENT_ERROR_STATUS["source_media_conflict"] == 409

    # Rolled back + swept: the loser's write never lands as a row or a file.
    db.expire_all()
    rows = db.query(Media).filter(Media.event_id == geo.id).all()
    assert [m.storage_url for m in rows] == [winner_url]
    uploads_dir = tmp_path / "uploads"
    leaked = list(uploads_dir.rglob("*.jpg")) if uploads_dir.exists() else []
    assert leaked == [], f"S3 orphans after the losing write: {leaked}"
