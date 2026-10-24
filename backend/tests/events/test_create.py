"""Write path for ``POST /events``: validation, the conflict floor, and proof-image intake
(proof files ride in the same multipart and resolve against ``placeholder://`` srcs). The
sources and their floor are covered in ``test_sources.py``.
"""

from __future__ import annotations

import json
import uuid
from io import BytesIO

from PIL import Image

from app.models.event import Event
from app.models.media import Media
from app.services.evidence_processing import UNREADABLE_IMAGE_MESSAGE
from app.services.sanitize import extract_image_srcs
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    WORLD_BBOX,
    client,
    filed_source,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
    stage_file,
)


def _form(author, conflict=None, *, sources: str | None = None, **overrides):
    """The minimal happy-path create form: one direct source with its staged file."""
    form = {
        "title": "x",
        "lat": "0.0",
        "lng": "0.0",
        "occurred_date": "2026-05-01",
        "proof": proof_form_field(),
        "sources": sources if sources is not None else filed_source(author),
    }
    if conflict is not None:
        form["conflict_ids"] = json.dumps([str(conflict.id)])
    form.update(overrides)
    return form


def _post(author, form, files=None):
    return client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=form,
        files=[proof_file_part()] if files is None else files,
    )


def _use_local_storage(monkeypatch, tmp_path) -> None:
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))


def test_create_requires_authentication():
    """Anon POST short-circuits in the dependency before file parsing."""
    response = client.post("/api/v1/events")
    assert response.status_code == 401


def test_create_requires_the_sources_field(author, conflict):
    """``sources`` is required: FastAPI 422s before the handler runs."""
    form = _form(author, conflict)
    del form["sources"]
    assert _post(author, form).status_code == 422


def test_create_rejects_invalid_latitude(author):
    """A malformed coordinate 400s before the write, so no object is stranded."""
    response = _post(author, _form(author, lat="95.0"))
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_coordinates"
    assert "Latitude" in detail["message"]


def test_create_rejects_a_camera_position_off_the_globe(author, conflict):
    sources = filed_source(author, camera_position={"lat": 10.0, "lng": 190.0})
    response = _post(author, _form(author, conflict, sources=sources))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_create_rejects_invalid_occurred_date(author):
    """A bad ``occurred_date`` is a 422 before any upload; unvalidated, it 500s at flush
    after the files are uploaded."""
    response = _post(author, _form(author, occurred_date="not-a-date"))
    assert response.status_code == 422
    assert "occurred_date" in response.json()["detail"].lower()


def test_create_event_date_tolerates_only_a_separated_time_tail(
    db, author, conflict, tmp_path, monkeypatch
):
    """The datetime form stores its date; a tail without the ISO separator 422s instead
    of being truncated."""
    _use_local_storage(monkeypatch, tmp_path)

    def _submit(occurred_date: str):
        return _post(
            author, _form(author, conflict, title="date tail", occurred_date=occurred_date)
        )

    plain = _submit("2026-05-01")
    assert plain.status_code == 201, plain.text
    assert plain.json()["occurred_date"] == "2026-05-01"

    with_time = _submit("2026-05-01T12:00:00Z")
    assert with_time.status_code == 201, with_time.text
    assert with_time.json()["occurred_date"] == "2026-05-01"

    for garbage in ("2026-05-01junk", "2026-05-0199"):
        response = _submit(garbage)
        assert response.status_code == 422, f"{garbage!r} → {response.status_code}"
        assert "occurred_date" in response.json()["detail"].lower()


def test_list_rejects_malformed_date_filter(author):
    """A bad ``submitted_to`` is a 422, not a 500 from a malformed Postgres timestamp."""
    response = client.get(
        f"/api/v1/events/points?bbox={WORLD_BBOX}&submitted_to=not-a-date",
        headers=login_as(client, author),
    )
    assert response.status_code == 422
    # Junk after the date is rejected too: the datetime tolerance covers only a T or
    # space separated tail.
    glued = client.get(
        f"/api/v1/events/points?bbox={WORLD_BBOX}&occurred_date_from=2026-05-0199",
        headers=login_as(client, author),
    )
    assert glued.status_code == 422


def test_create_rejects_too_many_proof_files(author, conflict):
    """A proof batch past ``max_proof_images_per_event`` is rejected before upload (caps
    Pillow and storage work per request)."""
    proof = "".join(f'<img src="placeholder://p-{i}.jpg">' for i in range(11))
    files = [("proof_files", (f"p-{i}.jpg", TINY_JPEG, "image/jpeg")) for i in range(11)]
    response = _post(author, _form(author, conflict, proof=proof), files)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "too_many_files"
    assert "proof images" in detail["message"]


def test_create_rejects_video_proof_file(author, conflict):
    """A proof part must be an image: a video could never render in the proof body."""
    proof = '<img src="placeholder://clip.mp4">'
    files = [("proof_files", ("clip.mp4", b"\x00\x00\x00 ftypmp42", "video/mp4"))]
    response = _post(author, _form(author, conflict, proof=proof), files)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_file"
    assert "image required" in detail["message"]


def test_create_rejects_a_proof_over_a_sanitiser_cap(author):
    """A proof past the sanitiser's tag-count cap is ``invalid_proof`` before any upload."""
    response = _post(author, _form(author, proof="<br>" * 10_001))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_proof"


def test_create_rejects_proof_without_image(author, conflict):
    """A proof body with no inline image 400s before any upload."""
    response = _post(author, _form(author, conflict, proof="<p>words only</p>"), [])
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"


def test_create_rejects_placeholder_without_matching_file(author, conflict):
    """A ``placeholder://`` src with no uploaded file of that name is a 400."""
    response = _post(
        author,
        _form(author, conflict, proof=proof_form_field("missing.jpg")),
        [proof_file_part("other.jpg")],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "proof_files_mismatch"
    assert "missing.jpg" in detail["message"]


def test_create_rejects_unreferenced_proof_file(author, conflict):
    """An uploaded proof file no placeholder references would be an untracked object: 400."""
    response = _post(
        author,
        _form(author, conflict, proof=proof_form_field("proof-1.jpg")),
        [proof_file_part("proof-1.jpg"), proof_file_part("stray.jpg")],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "proof_files_mismatch"
    assert "stray.jpg" in detail["message"]


def test_create_rejects_missing_conflict(author):
    response = _post(author, _form(author))
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "conflict_required"
    assert "conflict" in detail["message"].lower()


def test_create_rejects_an_unknown_conflict(author):
    """A bogus conflict id resolves to nothing and fails like an empty list."""
    response = _post(author, _form(author, conflict_ids=json.dumps([str(uuid.uuid4())])))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "conflict_required"


def test_create_needs_no_tag(author, conflict):
    """A conflict and the evidence publish; tags are optional."""
    response = _post(author, _form(author, conflict))
    assert response.status_code == 201, response.text
    assert response.json()["tags"] == []


def test_create_succeeds_with_full_floor(db, author, conflict, free_tag, tmp_path, monkeypatch):
    """The placeholder src is rewritten to a real URL and a proof media row lands beside
    the source's file."""
    _use_local_storage(monkeypatch, tmp_path)
    sources = filed_source(author, camera_position={"lat": 48.6, "lng": 34.6})

    response = _post(
        author,
        _form(
            author,
            conflict,
            sources=sources,
            title="valid create",
            lat="48.5",
            lng="34.5",
            tag_ids=json.dumps([str(free_tag.id)]),
        ),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert [t["name"] for t in body["tags"]] == [free_tag.name]
    assert [c["name"] for c in body["conflicts"]] == [conflict.name]
    assert body["status"] == "geolocated"
    assert body["coords"] == {"lat": 48.5, "lng": 34.5}
    [source] = body["sources"]
    assert source["camera_position"] == {"lat": 48.6, "lng": 34.6}
    # The creator is the owner AND the first geolocator (durable credit).
    assert body["owner"]["username"] == author.username
    assert [g["username"] for g in body["geolocators"]] == [author.username]
    srcs = extract_image_srcs(body["proof"])
    assert len(srcs) == 1
    assert srcs[0].startswith("http")  # placeholder rewritten to the landed URL
    assert "placeholder://" not in body["proof"]

    rows = db.query(Media).filter(Media.event_id == uuid.UUID(body["id"])).all()
    proof_row = next(m for m in rows if m.source_id is None)
    assert proof_row.storage_url == srcs[0]
    assert proof_row.sha256 and len(proof_row.sha256) == 64
    assert proof_row.original_filename == "proof-1.jpg"
    assert db.query(Media).filter(Media.source_id == uuid.UUID(source["id"])).one().id == (
        uuid.UUID(source["media"]["id"])
    )


def test_create_round_trips_link_posted_at_and_occurred_time(
    db, author, conflict, tmp_path, monkeypatch
):
    """A link's ``posted_at`` and the event's ``occurred_time`` round-trip; an omitted
    ``occurred_time`` is null."""
    _use_local_storage(monkeypatch, tmp_path)

    def _base():
        sources = filed_source(author, url="https://t.me/c/1", posted_at="2026-05-03T08:15")
        return _form(author, conflict, sources=sources, title="with source time")

    with_time = _post(author, {**_base(), "occurred_time": "14:30"})
    assert with_time.status_code == 201, with_time.text
    [link] = with_time.json()["sources"][0]["links"]
    assert link["posted_at"].startswith("2026-05-03T08:15")
    assert with_time.json()["occurred_time"] == "14:30:00"

    without = _post(author, _base())
    assert without.status_code == 201, without.text
    assert without.json()["occurred_time"] is None


def test_create_accepts_missing_occurred_date(db, author, conflict, tmp_path, monkeypatch):
    """An omitted ``occurred_date`` reads as Unknown."""
    _use_local_storage(monkeypatch, tmp_path)
    form = _form(author, conflict, title="date unknown")
    del form["occurred_date"]

    response = _post(author, form)
    assert response.status_code == 201, response.text
    assert response.json()["occurred_date"] is None


def test_create_cleans_up_storage_when_proof_file_is_corrupt(
    db, author, conflict, tmp_path, monkeypatch
):
    """A mid-batch failure sweeps the proof keys already uploaded instead of stranding
    them, and leaves the staged source file to a retry."""
    _use_local_storage(monkeypatch, tmp_path)
    upload_id = stage_file(author)

    response = _post(
        author,
        _form(
            author,
            conflict,
            sources=sources_field(source_spec(upload_id=upload_id)),
            title="orphan cleanup test",
        ),
        [("proof_files", ("proof-1.jpg", b"\xff\xd8\xff\xd9", "image/jpeg"))],
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "evidence_processing_failed"
    assert detail["message"]

    proof_dir = tmp_path / "proof"
    leaked = list(proof_dir.rglob("*.jpg")) if proof_dir.exists() else []
    assert leaked == [], f"Orphans after rolled-back create: {leaked}"
    assert db.query(Event).filter(Event.owner_id == author.id).count() == 0

    retry = _post(
        author, _form(author, conflict, sources=sources_field(source_spec(upload_id=upload_id)))
    )
    assert retry.status_code == 201, retry.text


def test_an_upload_names_the_accepted_formats_when_refusing_an_image(author):
    """An undecodable file is refused whatever type it declares, naming the allowed
    formats."""
    tiff = BytesIO()
    Image.new("RGB", (4, 4)).save(tiff, format="TIFF")

    response = client.post(
        "/api/v1/uploads",
        headers=login_as(client, author),
        files={"file": ("scan.png", tiff.getvalue(), "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "evidence_processing_failed",
        "message": UNREADABLE_IMAGE_MESSAGE,
    }
