"""Write path for ``POST /events`` (the direct geolocate).

Auth + validation (coordinates, dates, file type, proof JSON), the required
conflict + `capture_source` floor, and the proof-image intake: proof
files ride in the same multipart and resolve against ``placeholder://`` srcs
in the proof document. Shared fixtures live in `conftest.py`; `client` and the
proof helpers in `_helpers.py`.
"""

from __future__ import annotations

import json

from app.models.event import Event
from app.models.media import Media
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import client, proof_file_part, proof_form_field

# ── POST /events, auth + validation paths ────────────────────────────────


def _form(**overrides):
    """The minimal happy-path create form (tags threaded per test)."""
    form = {
        "title": "x",
        "lat": "0.0",
        "lng": "0.0",
        "source_url": "https://example.com",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
    }
    form.update(overrides)
    return form


def _files(*extra):
    """One source file + one matching proof file (the intake floor)."""
    return [("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part(), *extra]


def test_create_requires_authentication():
    """Anon POST short-circuits in the dependency before file parsing."""
    response = client.post("/api/v1/events")
    assert response.status_code == 401


def test_create_rejects_missing_file(author):
    """Empty multipart with no source file → rejected.

    The `file: UploadFile = File(...)` signature requires the part in the
    multipart body; FastAPI rejects the request with 422 before the handler
    runs (the service's own media floor backs it as a 400).
    """
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(),
    )
    assert response.status_code in (400, 422)


def test_create_rejects_invalid_latitude(author):
    """Out-of-range coord is rejected by the handler before any upload.

    Important property: this 400 fires *before* the S3 uploads so a
    malformed coord can never strand half-written S3 objects.
    """
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(lat="95.0"),
        files=_files(),
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_coordinates"
    assert "Latitude" in detail["message"]


def test_create_rejects_half_typed_capture_coords(author):
    """The optional camera point is both-or-neither; a lone half is a client
    bug surfaced as 400, not silently dropped."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(capture_source_lat="10.0"),
        files=_files(),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_create_rejects_invalid_event_date(author):
    """``event_date='not-a-date'`` returns a clean 422 before any S3
    round-trip. Before the fix the raw string flowed through to a
    ``Mapped[date]`` column and 500'd at flush, AFTER the files
    had already been uploaded. 422 matches the ``_parse_filter_date``
    / ``_parse_bbox`` shape so malformed-input rejections share a code."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(event_date="not-a-date"),
        files=_files(),
    )
    assert response.status_code == 422
    assert "event_date" in response.json()["detail"].lower()


def test_list_rejects_malformed_date_filter(author):
    """``submitted_to=not-a-date`` returns 422, NOT a 500. Before the
    fix the raw string was concatenated with ``' 23:59:59'`` and
    handed to Postgres, which raised ``InvalidDatetimeFormat`` and
    surfaced as a 500. ``/points`` will be anonymous-reachable once read
    endpoints open, so this is a Sentry-noise + abuse-amplifier vector."""
    response = client.get(
        "/api/v1/events/points?submitted_to=not-a-date",
        headers=login_as(client, author),
    )
    assert response.status_code == 422


def test_create_rejects_too_many_proof_files(author, conflict, capture_source_tag):
    """A proof batch past ``max_proof_images_per_event`` (10) is rejected
    before any upload. Without the cap, one submit can pin the worker
    through the Pillow + S3 pipeline for dozens of files in one request."""
    doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {"src": f"placeholder://p-{i}.jpg"}} for i in range(11)
        ],
    }
    files = [("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))]
    files += [("proof_files", (f"p-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(11)]
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            proof=json.dumps(doc),
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=files,
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "too_many_files"
    assert "proof images" in detail["message"]


def test_create_rejects_disallowed_file_type(author, conflict, capture_source_tag):
    """A source file with a MIME type outside `ALLOWED_TYPES` is rejected with
    the typed `invalid_file` envelope BEFORE any S3 IO. Passes the required
    tags + proof so the request reaches the file-validate loop in the intake,
    without them, an earlier floor guard fires first and the test exercises
    the wrong code path."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[("file", ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")), proof_file_part()],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_file"
    assert "not allowed" in detail["message"].lower()


def test_create_rejects_video_proof_file(author, conflict, capture_source_tag):
    """A proof part must be an image, the proof body embeds ``<img>`` nodes,
    so a video there could never render."""
    doc = {
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "placeholder://clip.mp4"}}],
    }
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            proof=json.dumps(doc),
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[
            ("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")),
            ("proof_files", ("clip.mp4", b"\x00\x00\x00 ftypmp42", "video/mp4")),
        ],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_file"
    assert "image required" in detail["message"]


def test_create_rejects_invalid_proof_json(author):
    """Invalid Tiptap proof JSON → 400 before any S3 upload."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(proof="{not valid json"),
        files=_files(),
    )
    assert response.status_code == 400
    assert "proof" in response.json()["detail"].lower()


def test_create_rejects_proof_without_image(author, conflict, capture_source_tag):
    """The proof-image floor: a proof body with no inline image 400s before
    any upload (a vouched location needs a visual argument)."""
    doc = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "words only"}]}],
    }
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            proof=json.dumps(doc),
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"


def test_create_rejects_placeholder_without_matching_file(author, conflict, capture_source_tag):
    """A ``placeholder://`` src with no uploaded file of that name is a 400
    (nothing uploads on a mismatched batch)."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            proof=proof_form_field("missing.jpg"),
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part("other.jpg")],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "proof_files_mismatch"
    assert "missing.jpg" in detail["message"]


def test_create_rejects_unreferenced_proof_file(author, conflict, capture_source_tag):
    """The reverse mismatch: an uploaded proof file no placeholder references
    would land as an untracked S3 object, 400 instead."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            proof=proof_form_field("proof-1.jpg"),
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[
            ("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")),
            proof_file_part("proof-1.jpg"),
            proof_file_part("stray.jpg"),
        ],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "proof_files_mismatch"
    assert "stray.jpg" in detail["message"]


# ── POST /events, required tag categories ────────────────────────────────


def test_create_rejects_no_tags(author):
    """No tags at all → 400. Conflict is checked first, before any upload."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(),
        files=_files(),
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_conflict(author, capture_source_tag):
    """A capture-source tag without a conflict → 400."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(tag_ids=json.dumps([str(capture_source_tag.id)])),
        files=_files(),
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_capture_source_tag(author, conflict):
    """A conflict without a capture-source tag → 400."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(conflict_ids=json.dumps([str(conflict.id)])),
        files=_files(),
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "capture source" in detail["message"].lower()


def test_create_rejects_free_tag_only(author, free_tag):
    """A free tag alone satisfies neither required category → 400.

    Guards against the resolved-category check being fooled by *any*
    tag being present, it has to be the right categories.
    """
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(tag_ids=json.dumps([str(free_tag.id)])),
        files=_files(),
    )
    assert response.status_code == 400


def test_create_succeeds_with_full_floor(
    db, author, conflict, capture_source_tag, tmp_path, monkeypatch
):
    """Coordinates + one source + a resolved proof image + the conflict and
    capture-source floor
    → 201; the placeholder src is rewritten to a real URL and a
    ``Media(role='proof')`` row lands alongside the source."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            title="valid create",
            lat="48.5",
            lng="34.5",
            capture_source_lat="48.6",
            capture_source_lng="34.6",
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=_files(),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert {t["category"] for t in body["tags"]} == {"capture_source"}
    assert [c["name"] for c in body["conflicts"]] == [conflict.name]
    assert body["status"] == "geolocated"
    assert body["geolocated_at"] is not None
    assert body["event_coords"] == {"lat": 48.5, "lng": 34.5}
    assert body["capture_source_coords"] == {"lat": 48.6, "lng": 34.6}
    # The creator is the owner AND the first geolocator (durable credit).
    assert body["owner"]["username"] == author.username
    assert [g["username"] for g in body["geolocators"]] == [author.username]
    # ``media`` carries only the source; the proof image travels in the doc.
    assert len(body["media"]) == 1
    assert body["media"][0]["role"] == "source"
    srcs = [node["attrs"]["src"] for node in body["proof"]["content"] if node["type"] == "image"]
    assert len(srcs) == 1
    assert srcs[0].startswith("http")  # placeholder rewritten to the landed URL
    assert "placeholder://" not in json.dumps(body["proof"])

    # Row-level: one source + one proof media.
    import uuid as _uuid

    rows = db.query(Media).filter(Media.event_id == _uuid.UUID(body["id"])).all()
    assert {m.role for m in rows} == {"source", "proof"}
    proof_row = next(m for m in rows if m.role == "proof")
    assert proof_row.storage_url == srcs[0]
    assert proof_row.sha256 and len(proof_row.sha256) == 64
    assert proof_row.original_filename == "proof-1.jpg"


def test_create_round_trips_source_posted_at_and_event_time(
    db, author, conflict, capture_source_tag, tmp_path, monkeypatch
):
    """``source_posted_at`` (required) and the optional ``event_time`` round-trip
    on the read model; ``event_time`` omitted → null."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    base = _form(
        title="with source time",
        lat="48.5",
        lng="34.5",
        source_url="https://t.me/c/1",
        source_posted_at="2026-05-03T08:15",
        tag_ids=json.dumps([str(capture_source_tag.id)]),
        conflict_ids=json.dumps([str(conflict.id)]),
    )

    with_time = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={**base, "event_time": "14:30"},
        files=_files(),
    )
    assert with_time.status_code == 201, with_time.text
    assert with_time.json()["source_posted_at"].startswith("2026-05-03T08:15")
    assert with_time.json()["event_time"] == "14:30:00"

    without = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=base,
        files=_files(),
    )
    assert without.status_code == 201, without.text
    assert without.json()["event_time"] is None


def test_create_rejects_invalid_source_posted_at(author):
    """Garbage ``source_posted_at`` → 422 before any S3 round-trip (same contract
    as ``event_date``)."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(source_posted_at="not-a-date"),
        files=_files(),
    )
    assert response.status_code == 422
    assert "source_posted_at" in response.json()["detail"].lower()


def test_create_cleans_up_s3_when_proof_file_is_corrupt(
    db, author, conflict, capture_source_tag, tmp_path, monkeypatch
):
    """A mid-batch upload failure must not strand orphan S3 objects.

    The source file uploads successfully, then the proof file is a corrupt
    JPEG that the EXIF-strip pre-pass rejects with a 400. Without cleanup the
    transaction rolls back and the source sits in S3 forever with no DB row
    pointing at it. With cleanup, the just-uploaded keys are swept via
    `Storage.delete_many` before the exception bubbles.

    Passes the required conflict + capture-source tag so the request
    reaches the upload stage, without them the required-category guard would
    400 *before* any upload and the test would pass vacuously.

    Uses local storage so we can inspect the filesystem directly.
    """
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_form(
            title="orphan cleanup test",
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        files=[
            ("file", ("ok.jpg", TINY_JPEG, "image/jpeg")),
            ("proof_files", ("proof-1.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")),
        ],
    )
    # The bad file fails EXIF-strip → 400 typed-error envelope from the service.
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "evidence_processing_failed"
    assert detail["message"]  # non-empty Pillow / strip_metadata message

    # Crucial invariant: no files were left behind on disk (source uploads
    # under uploads/, proof images under proof/).
    leaked = []
    for prefix in ("uploads", "proof"):
        base = tmp_path / prefix
        if base.exists():
            leaked.extend(base.rglob("*.jpg"))
    assert leaked == [], f"S3 orphans after rolled-back create: {leaked}"

    # And no Event / Media rows committed.
    assert db.query(Event).filter(Event.owner_id == author.id).count() == 0
