"""Write path for `/geolocations`.

`POST /geolocations` auth + validation (coordinates, dates, file count/type,
proof JSON) and the required `conflict` / `capture_source` tag floor, plus the
`POST /geolocations/proof-images` sha256 + provenance contract. Shared fixtures
live in `conftest.py`; `client` / `_make_geo` in `_helpers.py`.
"""

from __future__ import annotations

import json

from app.models.event import Event
from app.models.proof_image import ProofImage
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import client

# ── POST /geolocations — auth + validation paths ──────────────────────────


def test_create_requires_authentication():
    """Anon POST short-circuits in the dependency before file parsing."""
    response = client.post("/api/v1/events")
    assert response.status_code == 401


def test_create_rejects_missing_files(author):
    """Empty multipart with no files → handler 400.

    The `files: list[UploadFile] = File(...)` signature requires at
    least one file in the multipart body; FastAPI rejects the request
    with 422 before the handler runs.
    """
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
        },
    )
    # FastAPI's `File(...)` requirement triggers 422 (validation), not
    # the handler's own 400. Either is acceptable as "rejected"; we
    # assert the contract loosely.
    assert response.status_code in (400, 422)


def test_create_rejects_invalid_latitude(author):
    """Out-of-range coord is rejected by the handler before any upload.

    Important property: this 400 fires *before* `await upload_file()`
    so a malformed coord can never strand half-written S3 objects.
    """
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "95.0",  # invalid
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_coordinates"
    assert "Latitude" in detail["message"]


def test_create_rejects_invalid_event_date(author):
    """``event_date='not-a-date'`` returns a clean 422 before any S3
    round-trip. Before the fix the raw string flowed through to a
    ``Mapped[date]`` column and 500'd at flush time — AFTER the files
    had already been uploaded. 422 matches the ``_parse_filter_date``
    / ``_parse_bbox`` shape so all malformed-input rejections on this
    router share one status code."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "not-a-date",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
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


def test_create_rejects_too_many_files(author):
    """A multipart with more than ``MAX_FILES_PER_GEOLOCATION`` files is
    rejected before any upload. Without the cap, one submit can pin the
    worker through Pillow + derivative + S3 work for hundreds of files
    in a single request."""
    # 13 small jpegs > the cap of 12.
    files = [("files", (f"tiny-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(13)]
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "too_many_files"
    assert "files per submission" in detail["message"]


def test_create_rejects_disallowed_file_type(author, conflict_tag, capture_source_tag):
    """A file with a MIME type outside `ALLOWED_TYPES` is rejected with the
    typed `invalid_file` envelope BEFORE any S3 IO. Passes the required
    tags so the request reaches the file-validate loop in the service —
    without them, the earlier tag-categories guard fires first and the
    test exercises the wrong code path."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files={"files": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_file"
    assert "not allowed" in detail["message"].lower()


def test_create_rejects_invalid_proof_json(author):
    """Invalid Tiptap proof JSON → 400 before any S3 upload."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "proof": "{not valid json",
        },
        files=files,
    )
    assert response.status_code == 400
    assert "proof" in response.json()["detail"].lower()


# ── POST /geolocations — required tag categories ──────────────────────────


def test_create_rejects_no_tags(author):
    """No tags at all → 400. Conflict is checked first, before any upload."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_conflict_tag(author, capture_source_tag):
    """A capture-source tag without a conflict tag → 400."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(capture_source_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_missing_capture_source_tag(author, conflict_tag):
    """A conflict tag without a capture-source tag → 400."""
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(conflict_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "tag_requirements_not_met"
    assert "capture source" in detail["message"].lower()


def test_create_rejects_free_tag_only(author, free_tag):
    """A free tag alone satisfies neither required category → 400.

    Guards against the resolved-category check being fooled by *any*
    tag being present — it has to be the right categories.
    """
    files = {"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")}
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(free_tag.id)]),
        },
        files=files,
    )
    assert response.status_code == 400


def test_create_succeeds_with_both_required_tags(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """Conflict + capture-source present → 201, both tags land on the row."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "valid create",
            "lat": "48.5",
            "lng": "34.5",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    categories = {t["category"] for t in body["tags"]}
    assert {"conflict", "capture_source"} <= categories


def test_create_round_trips_source_posted_at_and_event_time(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """``source_posted_at`` (required) and the optional ``event_time`` round-trip
    on the read model; ``event_time`` omitted → null."""
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    base = {
        "title": "with source time",
        "lat": "48.5",
        "lng": "34.5",
        "source_url": "https://t.me/c/1",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-03T08:15",
        "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
    }

    with_time = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={**base, "event_time": "14:30"},
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert with_time.status_code == 201, with_time.text
    assert with_time.json()["source_posted_at"].startswith("2026-05-03T08:15")
    assert with_time.json()["event_time"] == "14:30:00"

    without = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=base,
        files={"files": ("ok.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert without.status_code == 201, without.text
    assert without.json()["event_time"] is None


def test_create_rejects_invalid_source_posted_at(author):
    """Garbage ``source_posted_at`` → 422 before any S3 round-trip (same contract
    as ``event_date``)."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "x",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "not-a-date",
        },
        files={"files": ("tiny.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 422
    assert "source_posted_at" in response.json()["detail"].lower()


# ── POST /geolocations/proof-images — sha256 contract ──────────────────────


def test_proof_image_upload_persists_sha256_and_provenance(db, author):
    """Inline-proof image upload captures sha256 + provenance on the row."""
    response = client.post(
        "/api/v1/events/proof-images",
        headers=login_as(client, author),
        files={"file": ("p.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert isinstance(body["sha256"], str)
    assert len(body["sha256"]) == 64
    assert "url" in body

    # Find the row by response sha256 (the EXIF strip re-encodes so we
    # can't predict it from the input). The response hash equals the
    # row hash — that's the consistency invariant.
    row = (
        db.query(ProofImage)
        .filter(ProofImage.user_id == author.id, ProofImage.sha256 == body["sha256"])
        .order_by(ProofImage.created_at.desc())
        .first()
    )
    assert row is not None, "proof_image row missing or sha256 not persisted"
    assert row.sha256 == body["sha256"]

    # Provenance fields landed.
    assert row.original_filename == "p.jpg"
    # 'testclient' isn't a parseable IP → NULL is the correct fail-safe.
    assert row.uploaded_ip is None
    assert row.uploaded_user_agent is not None

    # Clean up the row + reset the per-user 24h ceiling for other tests.
    db.query(ProofImage).filter(ProofImage.id == row.id).delete(synchronize_session=False)
    db.commit()


def test_proof_image_upload_rejects_corrupt_image(db, author):
    """A 4-byte stub that's the right MIME but not a real JPEG → 400.

    Pillow's EXIF-strip pre-decode catches truncated / malformed
    images before they reach S3, so we surface the failure as 400
    rather than letting half-written objects strand.
    """
    response = client.post(
        "/api/v1/events/proof-images",
        headers=login_as(client, author),
        files={"file": ("bad.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert response.status_code == 400
    assert "decode" in response.json()["detail"].lower()


def test_create_geolocation_cleans_up_s3_on_mid_batch_failure(
    db, author, conflict_tag, capture_source_tag, tmp_path, monkeypatch
):
    """Mid-batch upload failure must not strand orphan S3 objects.

    File #1 uploads successfully, file #2 is a corrupt JPEG that the
    EXIF-strip pre-pass rejects with a 400. Without cleanup the
    transaction rolls back and file #1 sits in S3 forever with no
    DB row pointing at it. With cleanup, the just-uploaded key is
    swept via `Storage.delete_many` before the exception bubbles.

    Passes the two required tags (conflict + capture source) so the
    request reaches the upload stage — without them the new required-
    category guard would 400 *before* any upload and the test would
    pass vacuously, exercising none of the cleanup path it's here for.

    Uses local storage so we can inspect the filesystem directly.
    """
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "orphan cleanup test",
            "lat": "0.0",
            "lng": "0.0",
            "source_url": "https://example.com",
            "event_date": "2026-05-01",
            "source_posted_at": "2026-05-01T12:00",
            "tag_ids": json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        },
        files=[
            ("files", ("ok.jpg", TINY_JPEG, "image/jpeg")),
            ("files", ("bad.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")),
        ],
    )
    # The bad file fails EXIF-strip → 400 typed-error envelope from the service.
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "evidence_processing_failed"
    assert detail["message"]  # non-empty Pillow / strip_metadata message

    # Crucial invariant: no .jpg files were left behind on disk.
    uploads_dir = tmp_path / "uploads"
    if uploads_dir.exists():
        leaked = list(uploads_dir.rglob("*.jpg"))
        assert leaked == [], (
            f"S3 orphans after rolled-back create: {leaked}. The mid-batch "
            f"cleanup block in routers/events.py::create_geolocation "
            f"failed to sweep them."
        )

    # And no Event / Media rows committed.
    assert db.query(Event).filter(Event.author_id == author.id).count() == 0
