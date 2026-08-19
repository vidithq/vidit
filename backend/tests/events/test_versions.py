"""Editing a published event through ``POST /events/{id}/versions``.

A ``geolocated`` row is the vouched record, so a correction files the version it
supersedes instead of overwriting it: ``event_versions`` gains a snapshot,
``events.version_no`` moves on, and ``GET /events/{id}/versions`` reads the
history back. The suite covers the write's three guards (owner, state, the published evidence
floor), the corrections it files (the evidence anchor included, which a version
records so the record still shows what the claim rested on), the media rules
that keep a past version renderable, and the row lock two concurrent edits
serialize on.

Shared fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` / the proof
helpers in ``_helpers.py``.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventVersion,
)
from app.models.media import Media
from app.models.source_archive import SourceArchive
from app.services import versions as versions_service
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)

# A stored proof image, on the dev media host the sanitiser admits, so a proof
# body can reference an already-uploaded URL the way an edit form does.
STORED_PROOF_URL = "http://localhost:8000/local-storage/proof/u/stored.jpg"

# A second stored image, on the same host, standing in for one that belongs to
# somebody else's event.
OTHER_EVENT_PROOF_URL = "http://localhost:8000/local-storage/proof/u/other-event.jpg"


def _proof_doc(src: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Cross-reference."}]},
            {"type": "image", "attrs": {"src": src}},
        ],
    }


def _published(db, author, conflict, capture_source_tag, *, proof_url=STORED_PROOF_URL, **kwargs):
    """A ``geolocated`` row carrying the whole published floor.

    One source media, one stored proof image referenced by the proof body, the
    conflict and the curated capture-source tag: exactly what an edit has to
    keep on the row.
    """
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        with_media=True,
        proof=_proof_doc(proof_url),
        tags=[capture_source_tag],
        conflicts=[conflict],
        **kwargs,
    )
    db.add(
        Media(
            event_id=geo.id,
            role="proof",
            storage_url=proof_url,
            media_type="image",
        )
    )
    db.commit()
    db.refresh(geo)
    return geo


def _form(conflict, capture_source_tag, **overrides):
    """The full edit form, keeping the stored proof image; override per test."""
    form = {
        "title": "Corrected title",
        "lat": "50.0",
        "lng": "30.0",
        "event_date": "2026-05-02",
        "source_posted_at": "2026-05-01T12:00",
        "proof": json.dumps(_proof_doc(STORED_PROOF_URL)),
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
    }
    form.update(overrides)
    return form


def _save_version(geo_id, user, **kwargs):
    return client.post(
        f"/api/v1/events/{geo_id}/versions",
        headers=login_as(client, user),
        **kwargs,
    )


def test_save_version_snapshots_the_old_version_and_bumps_the_row(
    db, author, conflict, capture_source_tag
):
    """The happy path: the edit lands, the superseded state is filed as version
    1, and the row becomes version 2."""
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    assert geo.version_no == 1

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, note="Coordinates were off by a block."),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Corrected title"
    assert body["event_coords"] == {"lat": 50.0, "lng": 30.0}
    assert body["version_no"] == 2
    assert body["status"] == "geolocated"

    db.expire_all()
    rows = db.query(EventVersion).filter(EventVersion.event_id == geo.id).all()
    assert len(rows) == 1
    snapshot_row = rows[0]
    assert snapshot_row.version_no == 1
    assert snapshot_row.edited_by_id == author.id
    assert snapshot_row.note == "Coordinates were off by a block."
    # The snapshot holds the state BEFORE the edit, which is the whole point.
    assert snapshot_row.snapshot["title"] == "Original title"
    assert snapshot_row.snapshot["event_coords"] == {"lat": 48.5, "lng": 34.5}
    assert snapshot_row.snapshot["proof_media"][0]["storage_url"] == STORED_PROOF_URL
    assert [t["id"] for t in snapshot_row.snapshot["tags"]] == [str(capture_source_tag.id)]


def test_an_edit_that_archives_the_source_files_one_version_holding_the_new_copy(
    db, author, conflict, capture_source_tag
):
    """The copy pasted with an edit lands in the version that edit produces.

    The archived copies are part of a version, and the snapshot is filed before
    the write applies, so the superseded version holds the copies the record had
    and the live row holds the one just recorded. One write, one version: the
    edit and the copy travel together rather than filing a version each.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_snapshot_url=wayback),
    )
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2
    assert response.json()["archived_source"] == {"url": wayback, "provider": "wayback"}

    db.expire_all()
    rows = db.query(EventVersion).filter(EventVersion.event_id == geo.id).all()
    assert len(rows) == 1
    assert rows[0].snapshot["archives"] == []


def test_save_version_files_one_version_for_a_mirror_copy(db, author, conflict, capture_source_tag):
    """A mirror's copy rides the edit exactly as the source's does: one write,
    one version, and the copy lands in the version that write produces."""
    mirror = "https://t.me/channel/424242"
    geo = _published(db, author, conflict, capture_source_tag, secondary_source_urls=[mirror])
    wayback = f"https://web.archive.org/web/20260811120000/{mirror}"

    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            secondary_source_urls=[mirror],
            secondary_snapshot_urls=[wayback],
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2
    assert response.json()["archived_secondary_sources"] == [
        {"url": wayback, "provider": "wayback"}
    ]

    db.expire_all()
    rows = db.query(EventVersion).filter(EventVersion.event_id == geo.id).all()
    assert len(rows) == 1
    assert rows[0].snapshot["archives"] == []


def test_an_edit_archives_the_post_the_detection_came_from(
    db, author, conflict, capture_source_tag
):
    """The provenance link is immutable and rots all the same, so the edit form
    carries its archived copy beside the locked field holding it."""
    provenance = "https://x.com/analyst/status/909090"
    geo = _published(db, author, conflict, capture_source_tag, detected_from_url=provenance)
    wayback = f"https://web.archive.org/web/20260811120000/{provenance}"

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, detected_from_snapshot_url=wayback),
    )
    assert response.status_code == 200, response.text
    assert response.json()["archived_detected_from"] == {"url": wayback, "provider": "wayback"}

    db.expire_all()
    row = db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).one()
    assert (row.original_url, row.origin) == (provenance, "detected_from")


def test_a_provenance_copy_alone_is_a_change(db, author, conflict, capture_source_tag):
    """Archiving the provenance link moves no field, and is still a version:
    which of a record's links are archived is part of what the record says."""
    provenance = "https://x.com/analyst/status/909090"
    geo = _published(db, author, conflict, capture_source_tag, detected_from_url=provenance)
    wayback = f"https://web.archive.org/web/20260811120000/{provenance}"
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, detected_from_snapshot_url=wayback),
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).version_no == 3


def test_a_non_canonical_re_paste_of_the_stored_copy_is_no_change(
    db, author, conflict, capture_source_tag
):
    """A snapshot URL travels through a browser, which is where a trailing slash
    comes from. The stored copy and the re-paste name one capture, so the save
    is refused rather than filing a version for a spelling.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, source_snapshot_url=wayback)
        ).status_code
        == 200
    )

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_snapshot_url=f"{wayback}/"),
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_dropping_a_mirror_drops_its_archived_copy(db, author, conflict, capture_source_tag):
    """A copy filed against a mirror the edit removed archives a link the record
    no longer declares, so it goes with the mirror. The version this edit
    supersedes still holds it, which is where that copy stays readable."""
    mirror = "https://t.me/channel/424242"
    geo = _published(db, author, conflict, capture_source_tag, secondary_source_urls=[mirror])
    wayback = f"https://web.archive.org/web/20260811120000/{mirror}"
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=mirror,
            origin="secondary_source",
            snapshot_url=wayback,
            provider="wayback",
        )
    )
    db.commit()

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, secondary_source_urls=[])
    )
    assert response.status_code == 200, response.text
    assert response.json()["secondary_source_urls"] == []
    assert response.json()["archived_secondary_sources"] == []

    db.expire_all()
    assert db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).count() == 0
    row = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert [a["original_url"] for a in row.snapshot["archives"]] == [mirror]


def test_promoting_an_archived_mirror_to_the_source_keeps_its_copy(
    db, author, conflict, capture_source_tag
):
    """The mirror an edit makes the source keeps the copy filed against it.

    Normalization drops the mirror equal to the new source, so the submitted
    mirror list stops naming it; dropping its copy on that absence would destroy
    the archive of the very link the edit just promoted, in the same write that
    promoted it. The row survives and is re-filed under origin ``source_url``.
    """
    mirror = "https://t.me/channel/424242"
    geo = _published(db, author, conflict, capture_source_tag, secondary_source_urls=[mirror])
    original = geo.source_url
    mirror_copy = f"https://web.archive.org/web/20260811120000/{mirror}"
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=mirror,
            origin="secondary_source",
            snapshot_url=mirror_copy,
            provider="wayback",
        )
    )
    db.commit()

    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            source_url=mirror,
            secondary_source_urls=[original],
        ),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source_url"] == mirror
    assert body["secondary_source_urls"] == [original]
    assert body["archived_source"] == {"url": mirror_copy, "provider": "wayback"}

    db.expire_all()
    row = db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).one()
    assert row.original_url == mirror
    assert row.origin == "source_url"


def test_save_version_refuses_a_mirror_snapshot_of_another_link(
    db, author, conflict, capture_source_tag
):
    """A paste that archives a different page is a 400, and the edit it rode
    with files no version."""
    mirror = "https://t.me/channel/424242"
    geo = _published(db, author, conflict, capture_source_tag, secondary_source_urls=[mirror])

    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            secondary_source_urls=[mirror],
            secondary_snapshot_urls=[
                f"https://web.archive.org/web/20260811120000/{geo.source_url}"
            ],
        ),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_original_mismatch"

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == 1


def test_a_version_holds_the_archived_copies_the_record_carried(
    db, author, conflict, capture_source_tag
):
    """A copy recorded before an edit is in the version that edit supersedes,
    so ``/v1`` renders the copies as that version had them."""
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=geo.source_url,
            origin="source_url",
            snapshot_url=wayback,
            provider="wayback",
        )
    )
    db.commit()

    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    db.expire_all()
    row = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert [
        (a["original_url"], a["snapshot_url"], a["provider"]) for a in row.snapshot["archives"]
    ] == [(geo.source_url, wayback, "wayback")]


def test_save_version_is_owner_only(db, author, second_user, conflict, capture_source_tag):
    """Another analyst cannot correct someone else's record; nothing is filed."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _save_version(geo.id, second_user, data=_form(conflict, capture_source_tag))
    assert response.status_code == 403
    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == 1


def test_save_version_is_geolocated_only(db, author, conflict, capture_source_tag):
    """Before publication there is no vouched version to supersede, so every
    other state answers 409 ``invalid_state``."""
    for status in (STATUS_DETECTED, STATUS_REQUESTED, STATUS_CLOSED):
        geo = _make_geo(
            db,
            author=author,
            status=status,
            with_media=True,
            proof=_proof_doc(STORED_PROOF_URL),
            tags=[capture_source_tag],
            conflicts=[conflict],
        )
        response = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
        assert response.status_code == 409, (status, response.text)
        assert response.json()["detail"]["code"] == "invalid_state"


# ── The evidence anchor moves, and the version keeps what it was ──────────


def _source_part(filename="swap.jpg"):
    return ("files", (filename, TINY_JPEG, "image/jpeg"))


def _source_row(db, geo):
    return db.query(Media).filter(Media.event_id == geo.id, Media.role == "source").one()


def test_save_version_swaps_the_source_media_and_the_version_keeps_the_old_one(
    db, author, conflict, capture_source_tag
):
    """The import picks the wrong media out of a multi-media post often enough
    that the owner has to be able to replace it, and the version it supersedes
    is where the old one stays readable."""
    geo = _published(db, author, conflict, capture_source_tag)
    old = _source_row(db, geo)
    old_id, old_url = str(old.id), old.storage_url

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, remove_media_ids=json.dumps([old_id])),
        files=[_source_part()],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [m["id"] for m in body["media"]] != [old_id]
    assert len(body["media"]) == 1

    db.expire_all()
    # One source media, the new one: the swap is a replacement, not an addition.
    assert _source_row(db, geo).storage_url != old_url
    # The version this edit filed describes the media it superseded whole, so
    # ``/v1`` renders the footage the published claim rested on.
    filed = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert [m["id"] for m in filed.snapshot["source_media"]] == [old_id]
    assert filed.snapshot["source_media"][0]["storage_url"] == old_url
    assert filed.snapshot["source_media"][0]["media_type"] == "image"


def test_save_version_edits_the_source_url_and_files_the_old_one(
    db, author, conflict, capture_source_tag
):
    """An analyst who finds the original post behind a repost corrects the link,
    and the version says what the record pointed at before."""
    geo = _published(db, author, conflict, capture_source_tag)
    original = geo.source_url

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_url="https://example.com/original"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == "https://example.com/original"

    db.expire_all()
    assert db.get(Event, geo.id).source_url == "https://example.com/original"
    filed = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert filed.snapshot["source_url"] == original


def test_an_anchor_correction_alone_is_a_change(db, author, conflict, capture_source_tag):
    """Neither half of the anchor is exempt from the no-change check, and
    neither is refused by it: a save that moves only the source URL, or only the
    source media, files its version."""
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    # Bring the row to exactly what the form posts, so the two saves below move
    # the anchor and nothing else.
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, source_url="https://a.test/2")
        ).status_code
        == 200
    )

    db.expire_all()
    old_id = str(_source_row(db, geo).id)
    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            source_url="https://a.test/2",
            remove_media_ids=json.dumps([old_id]),
        ),
        files=[_source_part()],
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 4


def test_a_version_keeps_the_one_source_cap(db, author, conflict, capture_source_tag):
    """A file with no removal beside it would leave the event on two source
    media, which is what ``uq_media_source_per_event`` forbids."""
    geo = _published(db, author, conflict, capture_source_tag)

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag), files=[_source_part()]
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "too_many_files"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0


def test_a_version_cannot_leave_the_record_without_footage(
    db, author, conflict, capture_source_tag
):
    """Dropping the source media with nothing to replace it fails the published
    floor, so the row keeps its media and its version."""
    geo = _published(db, author, conflict, capture_source_tag)
    old_id = str(_source_row(db, geo).id)

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, remove_media_ids=json.dumps([old_id])),
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "media_required"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert str(_source_row(db, geo).id) == old_id


def test_a_blank_source_url_is_refused_and_an_absent_one_keeps_it(
    db, author, conflict, capture_source_tag
):
    """A published row always carries a source (``ck_events_source_url_status``),
    so blanking the field is a 400; leaving it out keeps what the row holds."""
    geo = _published(db, author, conflict, capture_source_tag)
    stored = geo.source_url

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, source_url="   ")
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "source_url_required"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1

    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).source_url == stored


def test_a_replaced_source_url_does_not_keep_the_old_ones_archived_copy(
    db, author, conflict, capture_source_tag
):
    """A copy is a copy of a link: once the source URL moves, the row filed
    against the old one no longer archives the event's source."""
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    db.add(
        SourceArchive(
            event_id=geo.id,
            original_url=geo.source_url,
            origin="source_url",
            snapshot_url=wayback,
            provider="wayback",
        )
    )
    db.commit()

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_url="https://example.com/original"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["archived_source"] is None

    db.expire_all()
    assert db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).count() == 0
    # The version that carried the copy still reads it.
    filed = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert [a["snapshot_url"] for a in filed.snapshot["archives"]] == [wayback]


def test_the_superseded_source_object_outlives_the_row_and_dies_with_the_history(
    db, author, admin_user, conflict, capture_source_tag, tmp_path, monkeypatch
):
    """An event carries one ``source`` row, so a swap deletes the one it
    replaces; the object stays, because the version filed by that same save is
    what renders it. Redacting the last version that named it frees it.
    """
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    geo = _published(db, author, conflict, capture_source_tag)
    stored = _source_row(db, geo)
    stored_url = "http://localhost:8000/local-storage/uploads/e/original.jpg"
    stored_id = stored.id
    stored.storage_url = stored_url
    db.commit()
    original = tmp_path / "uploads" / "e" / "original.jpg"
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(TINY_JPEG)

    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, remove_media_ids=json.dumps([str(stored_id)])),
            files=[_source_part()],
        ).status_code
        == 200
    )

    db.expire_all()
    # The row is gone (the index allows one) and the object is not.
    assert db.query(Media).filter(Media.id == stored_id).count() == 0
    assert original.exists()
    # The version still serves what it rested on.
    served = client.get(f"/api/v1/events/{geo.id}/versions/1").json()
    assert served["snapshot"]["source_media"][0]["storage_url"] == stored_url

    # Redaction is what frees it: nothing readable names that media any more.
    assert _redact(geo.id, 1, admin_user).status_code == 200
    assert not original.exists()


def test_save_version_holds_the_published_floor(db, author, conflict, capture_source_tag):
    """An edit cannot drop a published row below the floor it cleared: dropping
    the conflict is a 400, and the row keeps its version."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, conflict_ids=json.dumps([])),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"

    # And the same for an image-less proof body.
    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            proof=json.dumps({"type": "doc", "content": []}),
        ),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0


def test_proof_image_a_version_still_shows_is_not_deleted(db, author, conflict, capture_source_tag):
    """The media rule: swapping the proof body for a fresh image drops the old
    one from the current set, but version 1 still shows it, so its row stays."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, proof=proof_form_field()),
        files=[proof_file_part()],
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    proof_urls = {
        m.storage_url
        for m in db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof")
    }
    # The new image landed and the referenced one survived its removal from the
    # current body: without the version floor the intake would have swept it.
    assert STORED_PROOF_URL in proof_urls
    assert len(proof_urls) == 2


def test_versions_read_lists_newest_first(db, author, conflict, capture_source_tag):
    """The history endpoint serves the superseded versions, newest first; the
    live row is the current version and is not among them."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, title="v2 title")
        ).status_code
        == 200
    )
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, title="v3 title", note="second"),
        ).status_code
        == 200
    )

    response = client.get(f"/api/v1/events/{geo.id}/versions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    assert [item["version_no"] for item in body["items"]] == [2, 1]
    assert [item["snapshot"]["title"] for item in body["items"]] == ["v2 title", "v1 title"]
    assert body["items"][0]["note"] == "second"
    assert body["items"][0]["edited_by"]["username"] == author.username
    assert body["items"][1]["note"] is None


def test_versions_read_is_empty_before_any_edit(db, author, conflict, capture_source_tag):
    geo = _published(db, author, conflict, capture_source_tag)
    response = client.get(f"/api/v1/events/{geo.id}/versions")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


def test_versions_read_404s_an_unknown_event(db, author):
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/versions").status_code == 404


def test_concurrent_versions_take_their_number_in_order(db, author, conflict, capture_source_tag):
    """Two edits of the same row at once serialize on the row lock.

    The lock plus ``populate_existing()`` is what makes the second writer read
    the post-lock ``version_no``: without it both would snapshot version 1 and
    the unique constraint would answer with a 500 instead of two clean edits.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    geo_id = geo.id

    statuses: list[int] = []
    barrier = threading.Barrier(2)

    def worker(title: str) -> None:
        c = TestClient(app)
        headers = login_as(c, author)
        data = _form(conflict, capture_source_tag, title=title)
        barrier.wait(timeout=2)
        statuses.append(
            c.post(f"/api/v1/events/{geo_id}/versions", headers=headers, data=data).status_code
        )

    threads = [
        threading.Thread(target=worker, args=("First edit",)),
        threading.Thread(target=worker, args=("Second edit",)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert statuses == [200, 200], statuses
    db.expire_all()
    assert db.get(Event, geo_id).version_no == 3
    numbers = [
        r.version_no
        for r in db.query(EventVersion)
        .filter(EventVersion.event_id == geo_id)
        .order_by(EventVersion.version_no)
    ]
    assert numbers == [1, 2]


# ── A version has to change something, and there are only so many ─────────


def test_an_edit_that_moves_nothing_is_refused(db, author, conflict, capture_source_tag):
    """Re-posting the state the row already holds is a 409, and files nothing.

    The form posts the whole editable state, so a reader who opens the edit page
    and saves without touching a field would otherwise mint a version whose
    changed-field list is empty and whose ``/vN`` address claims a correction
    that never happened.
    """
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    # One real edit first, so the row now holds exactly what this form posts.
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    response = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 1
    assert db.get(Event, geo.id).version_no == 2


def test_a_note_alone_does_not_make_a_version(db, author, conflict, capture_source_tag):
    """The note annotates a change; on its own there is none to annotate."""
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, note="Checked it again.")
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_a_new_archived_copy_is_a_change_and_the_same_one_is_not(
    db, author, conflict, capture_source_tag
):
    """A copy the link does not hold yet is a change on its own; re-pasting the
    copy it already holds is not."""
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    # No field moves, but the copy is new, so the edit is a change.
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, source_snapshot_url=wayback),
        ).status_code
        == 200
    )

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, source_snapshot_url=wayback)
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 3


def test_an_event_stops_at_the_version_ceiling(db, author, conflict, capture_source_tag):
    """Version 100 is the last one an edit can produce, and the refusal says so
    without pointing anyone at an admin who has no verb for it."""
    geo = _published(db, author, conflict, capture_source_tag)
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, title="One more")
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "version_limit"
    assert response.json()["detail"]["message"] == (
        "This event has reached 100 versions and can no longer be edited."
    )

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == versions_service.MAX_VERSIONS_PER_EVENT


def test_a_save_that_only_archives_passes_the_ceiling(db, author, conflict, capture_source_tag):
    """Preserving evidence never waits on a quota.

    A save whose only change is an archived copy files version 101 on a row at
    the ceiling: an original that dies while the event sits at 100 would
    otherwise be unarchivable for good, which is a worse record than one more
    version.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    # One real edit first, so the form below re-posts exactly what the row holds
    # and the archived copy is the only thing that moves.
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    db.expire_all()
    geo = db.get(Event, geo.id)
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, source_snapshot_url=wayback)
    )
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == versions_service.MAX_VERSIONS_PER_EVENT + 1
    assert response.json()["archived_source"] == {"url": wayback, "provider": "wayback"}


def test_an_edit_carrying_a_copy_still_meets_the_ceiling(db, author, conflict, capture_source_tag):
    """The exemption is for a save that ONLY archives. A correction that also
    moves a field is an edit, and an edit stops at 100."""
    geo = _published(db, author, conflict, capture_source_tag)
    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, title="One more", source_snapshot_url=wayback),
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "version_limit"

    db.expire_all()
    assert db.query(SourceArchive).filter(SourceArchive.event_id == geo.id).count() == 0


# ── Optional source post time ─────────────────────────────────────────────


def test_save_version_accepts_a_row_with_no_source_post_time(
    db, author, conflict, capture_source_tag
):
    """A detection published without a resolved source post time is editable.

    ``_publish_detection`` puts such a row on the map with ``source_posted_at``
    NULL, so the correction path has to accept the same shape rather than force
    its owner to invent an instant.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    geo.source_posted_at = None
    db.commit()

    form = _form(conflict, capture_source_tag)
    del form["source_posted_at"]
    response = _save_version(geo.id, author, data=form)
    assert response.status_code == 200, response.text
    assert response.json()["source_posted_at"] is None
    assert response.json()["version_no"] == 2

    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at is None
    # An empty string reads the same as an absent field, and a NULL row stays
    # NULL through it. The title moves so the edit is a change at all: an edit
    # that moves nothing is refused.
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, source_posted_at="", title="Corrected again"),
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at is None


def test_a_blank_source_post_time_keeps_the_stored_one(db, author, conflict, capture_source_tag):
    """Blank means keep, never clear.

    The form posts the whole state and the field is always rendered, so an empty
    datetime input reaches the service indistinguishable from an absent one.
    Clearing on that would let an edit of the title silently drop the instant a
    published record was vouched with.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    stored = db.get(Event, geo.id).source_posted_at
    assert stored is not None

    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, source_posted_at="")
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at == stored

    # An omitted field reads the same way. The title moves on each call, since
    # an edit that moves nothing at all is refused.
    form = _form(conflict, capture_source_tag, title="Corrected again")
    del form["source_posted_at"]
    assert _save_version(geo.id, author, data=form).status_code == 200
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at == stored

    # A posted value replaces it.
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_posted_at="2026-06-07T08:09"),
    )
    assert response.status_code == 200, response.text
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at == datetime(2026, 6, 7, 8, 9, tzinfo=UTC)


# ── What a snapshot claims, and what that keeps alive ─────────────────────


def test_snapshot_lists_only_the_images_that_version_displayed(
    db, author, conflict, capture_source_tag
):
    """``proof_media`` is the version's own body, not every proof row on the row.

    Version 1 shows the stored image; version 2 replaces it with a fresh upload
    and keeps the first row alive for version 1. Version 2's snapshot must
    therefore claim the new image alone: claiming the old one too would both
    misreport what that version showed and pin the image past the last version
    that displayed it.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, proof=proof_form_field()),
            files=[proof_file_part()],
        ).status_code
        == 200
    )
    # A second edit that changes nothing about the images files version 2.
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, title="v3")
        ).status_code
        == 200
    )

    db.expire_all()
    rows = {r.version_no: r for r in db.query(EventVersion).filter(EventVersion.event_id == geo.id)}
    assert [m["storage_url"] for m in rows[1].snapshot["proof_media"]] == [STORED_PROOF_URL]
    # Version 2 displayed the uploaded image only, even though the row still
    # carries the first one for version 1's sake.
    v2_urls = [m["storage_url"] for m in rows[2].snapshot["proof_media"]]
    assert STORED_PROOF_URL not in v2_urls
    assert len(v2_urls) == 1
    # Both rows are still there: version 1 displays one, version 2 the other.
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").count() == 2


def test_proof_image_cap_counts_what_the_new_body_displays(
    db, author, conflict, capture_source_tag, monkeypatch
):
    """The ceiling is on the post-write body, not on one request.

    One image the body keeps plus one upload is two images on a one-image cap,
    so the write is refused before anything reaches S3. Counting the batch alone
    would have let the event grow past the ceiling one upload at a time.
    """
    monkeypatch.setattr(settings, "max_proof_images_per_event", 1)
    geo = _published(db, author, conflict, capture_source_tag)

    doc = _proof_doc(STORED_PROOF_URL)
    doc["content"].append({"type": "image", "attrs": {"src": "placeholder://proof-1.jpg"}})
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, proof=json.dumps(doc)),
        files=[proof_file_part()],
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "too_many_files"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").count() == 1


def test_history_pinned_images_do_not_consume_the_cap(
    db, author, conflict, capture_source_tag, monkeypatch
):
    """An image kept only so an old version renders is not charged to the owner.

    Each edit here swaps the one image the body displays for a fresh upload, so
    the body never shows more than one on a one-image cap. The superseded rows
    stay on the event to keep the history renderable, and counting them would
    make swapping an image spend the quota permanently, with nothing the owner
    could free.
    """
    monkeypatch.setattr(settings, "max_proof_images_per_event", 1)
    geo = _published(db, author, conflict, capture_source_tag)

    for filename in ("proof-1.jpg", "proof-2.jpg"):
        response = _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, proof=proof_form_field(filename)),
            files=[proof_file_part(filename)],
        )
        assert response.status_code == 200, (filename, response.text)

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 3
    # Three rows on a one-image cap: the current body displays one, the two
    # versions behind it display the others.
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").count() == 3


def test_save_version_rejects_a_proof_image_belonging_to_another_event(
    db, author, second_user, conflict, capture_source_tag
):
    """A stored image is admitted by its host, but has to be this event's own.

    Embedding another event's proof URL would put that event's owner in charge
    of the file: their next edit or redact drops the row and sweeps the
    object, and this body would render a hole.
    """
    foreign = _published(
        db, second_user, conflict, capture_source_tag, proof_url=OTHER_EVENT_PROOF_URL
    )
    geo = _published(db, author, conflict, capture_source_tag)

    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict, capture_source_tag, proof=json.dumps(_proof_doc(OTHER_EVENT_PROOF_URL))
        ),
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "invalid_file"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    # The other event still owns its image.
    assert db.query(Media).filter(Media.event_id == foreign.id, Media.role == "proof").count() == 1

    # The same body pointing at this event's own stored image is accepted.
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_a_proof_body_may_cite_the_events_own_source_media(
    db, author, conflict, capture_source_tag
):
    """Ownership is per event, not per role.

    A proof body legitimately shows a frame of the footage being located, which
    is the event's own ``source`` row. That object dies only with the event that
    owns it, so refusing the src would reject a body naming nothing but its own
    evidence.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    source_row = db.query(Media).filter(Media.event_id == geo.id, Media.role == "source").one()
    # On the media host, so the sanitiser admits the src and the ownership check
    # is the only thing left to decide it.
    source_row.storage_url = "http://localhost:8000/local-storage/uploads/e/source.jpg"
    db.commit()

    body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The frame."}]},
            {"type": "image", "attrs": {"src": STORED_PROOF_URL}},
            {"type": "image", "attrs": {"src": source_row.storage_url}},
        ],
    }
    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, proof=json.dumps(body))
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    # The source row is not a proof row, so the proof diff never considered it
    # for deletion either.
    assert db.query(Media).filter(Media.id == source_row.id).count() == 1


def test_a_proof_body_may_cite_a_source_media_a_correction_superseded(
    db, author, conflict, capture_source_tag
):
    """Ownership survives the swap that deletes the row.

    A proof legitimately shows a frame of the footage being located. Correcting
    the anchor deletes the ``source`` row that frame came from, while the object
    stays and the version's snapshot is what still names it, so reading
    ownership off the live rows alone would 400 the correction itself and every
    later write of that body.
    """
    geo = _published(db, author, conflict, capture_source_tag)
    superseded = _source_row(db, geo)
    superseded_url = "http://localhost:8000/local-storage/uploads/e/superseded.jpg"
    superseded.storage_url = superseded_url
    superseded_id = str(superseded.id)
    db.commit()

    body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The frame."}]},
            {"type": "image", "attrs": {"src": STORED_PROOF_URL}},
            {"type": "image", "attrs": {"src": superseded_url}},
        ],
    }
    # The correction that supersedes the cited frame, carrying the body that
    # cites it.
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(
                conflict,
                capture_source_tag,
                proof=json.dumps(body),
                remove_media_ids=json.dumps([superseded_id]),
            ),
            files=[_source_part()],
        ).status_code
        == 200
    )

    db.expire_all()
    assert db.query(Media).filter(Media.id == superseded_id).count() == 0

    # Every later write of the same body: the row is gone for good, so this is
    # the leg that would 400 on every edit from here on.
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, title="Second correction", proof=json.dumps(body)),
    )
    assert response.status_code == 200, response.text


# ── Reading the history ───────────────────────────────────────────────────


def test_versions_read_is_paged(db, author, conflict, capture_source_tag):
    """A long history walks the shared cursor, and ``total`` stays the whole set."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1")
    for title in ("v2", "v3", "v4"):
        assert (
            _save_version(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title)
            ).status_code
            == 200
        )

    first = client.get(f"/api/v1/events/{geo.id}/versions?limit=2")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 3
    assert [item["version_no"] for item in body["items"]] == [3, 2]

    link = first.headers["Link"]
    assert link.endswith('; rel="next"')
    cursor = parse_qs(urlparse(link[1 : link.index(">")]).query)["cursor"][0]

    second = client.get(f"/api/v1/events/{geo.id}/versions?limit=2&cursor={cursor}")
    assert second.status_code == 200, second.text
    assert [item["version_no"] for item in second.json()["items"]] == [1]
    # The last page names no next one.
    assert "Link" not in second.headers


def test_history_orders_on_the_version_number_not_the_clock(
    db, author, conflict, capture_source_tag
):
    """``created_at`` is the application's clock, so it skews between instances.

    The list claims ``version_no`` order, so it reads and pages on that number,
    which one row lock assigns and which no clock can reorder. Version 2 is
    stamped before version 1 here; the history is unmoved.
    """
    geo = _published(db, author, conflict, capture_source_tag, title="v1")
    for title in ("v2", "v3", "v4"):
        assert (
            _save_version(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title)
            ).status_code
            == 200
        )

    db.expire_all()
    rows = {r.version_no: r for r in db.query(EventVersion).filter(EventVersion.event_id == geo.id)}
    rows[2].created_at = rows[1].created_at - timedelta(days=1)
    db.commit()

    first = client.get(f"/api/v1/events/{geo.id}/versions?limit=2")
    assert first.status_code == 200, first.text
    assert [item["version_no"] for item in first.json()["items"]] == [3, 2]

    link = first.headers["Link"]
    cursor = parse_qs(urlparse(link[1 : link.index(">")]).query)["cursor"][0]
    second = client.get(f"/api/v1/events/{geo.id}/versions?limit=2&cursor={cursor}")
    assert second.status_code == 200, second.text
    assert [item["version_no"] for item in second.json()["items"]] == [1]


def test_versions_read_rejects_a_malformed_cursor(db, author, conflict, capture_source_tag):
    """A cursor that does not decode to a version number is a 422, not a 500."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert client.get(f"/api/v1/events/{geo.id}/versions?cursor=not-a-cursor").status_code == 422


def test_versions_read_serves_a_withheld_row_to_an_admin_only(
    db, author, admin_user, conflict, capture_source_tag
):
    """A takedown hides the history from everyone but an admin, who has to read
    what was taken down in order to judge the report that took it down."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert client.get(f"/api/v1/events/{geo.id}/versions").status_code == 404
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/versions", headers=login_as(client, author)
        ).status_code
        == 404
    )
    response = client.get(f"/api/v1/events/{geo.id}/versions", headers=login_as(client, admin_user))
    assert response.status_code == 200, response.text
    assert [item["version_no"] for item in response.json()["items"]] == [1]


def test_one_version_reads_by_its_number(db, author, conflict, capture_source_tag):
    """The direct read behind ``/vN``: one version, without walking the list."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    for title in ("v2 title", "v3 title"):
        assert (
            _save_version(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title, note=title)
            ).status_code
            == 200
        )

    response = client.get(f"/api/v1/events/{geo.id}/versions/1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version_no"] == 1
    assert body["snapshot"]["title"] == "v1 title"
    assert body["note"] == "v2 title"
    assert body["edited_by"]["username"] == author.username
    assert body["redacted"] is False

    assert client.get(f"/api/v1/events/{geo.id}/versions/2").json()["snapshot"]["title"] == (
        "v2 title"
    )


def test_one_version_404s_outside_the_filed_history(db, author, conflict, capture_source_tag):
    """The live row is the current version and is not filed, so its own number
    answers 404 here; so does a number the event never carried, and an unknown
    event."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    assert client.get(f"/api/v1/events/{geo.id}/versions/2").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/versions/9").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/versions/0").status_code == 404
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/versions/1").status_code == 404


def test_one_version_serves_a_redacted_version_blanked(
    db, author, admin_user, conflict, capture_source_tag
):
    """A redacted version is not a missing one: the address stays, and the page
    it serves is the blanked row rather than a 404."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, note="why")
        ).status_code
        == 200
    )
    assert _redact(geo.id, 1, admin_user).status_code == 200

    response = client.get(f"/api/v1/events/{geo.id}/versions/1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["redacted"] is True
    assert body["snapshot"] == {}
    assert body["note"] is None
    assert body["edited_by"]["username"] == author.username


def test_one_version_serves_a_withheld_row_to_an_admin_only(
    db, author, admin_user, conflict, capture_source_tag
):
    """The direct read takes the same takedown branch as the list."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert client.get(f"/api/v1/events/{geo.id}/versions/1").status_code == 404
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/versions/1", headers=login_as(client, author)
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/versions/1", headers=login_as(client, admin_user)
        ).status_code
        == 200
    )


# ── Redaction ─────────────────────────────────────────────────────────────


def _redact(geo_id, version_no, user):
    return client.post(
        f"/api/v1/admin/events/{geo_id}/versions/{version_no}/redact",
        headers=login_as(client, user),
    )


def test_redact_is_admin_only(db, author, conflict, capture_source_tag):
    """The owner cannot blank their own history; only an admin can."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )

    assert _redact(geo.id, 1, author).status_code == 403
    db.expire_all()
    row = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    assert row.redacted_at is None
    assert row.snapshot != {}


def test_redact_blanks_the_version_and_keeps_its_number(
    db, author, admin_user, conflict, capture_source_tag
):
    """The content goes, the row and its address stay, and a second call is a
    no-op rather than a second redaction."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, capture_source_tag, note="why")
        ).status_code
        == 200
    )

    response = _redact(geo.id, 1, admin_user)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["redacted"] is True
    assert body["version_no"] == 1
    assert body["snapshot"] == {}
    assert body["note"] is None
    assert body["edited_by"]["username"] == author.username

    db.expire_all()
    row = db.query(EventVersion).filter(EventVersion.event_id == geo.id).one()
    first_stamp = row.redacted_at
    assert first_stamp is not None
    assert row.redacted_by_id == admin_user.id

    # Idempotent: the second call changes nothing.
    assert _redact(geo.id, 1, admin_user).status_code == 200
    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).one().redacted_at == (
        first_stamp
    )

    # The history still lists the version, marked, so ``/vN`` never shifts.
    listing = client.get(f"/api/v1/events/{geo.id}/versions").json()
    assert listing["total"] == 1
    assert listing["items"][0]["version_no"] == 1
    assert listing["items"][0]["redacted"] is True
    assert listing["items"][0]["snapshot"] == {}


def test_redact_frees_the_image_only_that_version_displayed(
    db, author, admin_user, conflict, capture_source_tag
):
    """A redacted version displays nothing, so the media floor stops holding its
    images: the one no readable version and no current body points at goes."""
    geo = _published(db, author, conflict, capture_source_tag)
    # Version 2's body replaces the stored image; version 1's snapshot is the
    # only thing still pointing at it.
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, proof=proof_form_field()),
            files=[proof_file_part()],
        ).status_code
        == 200
    )
    db.expire_all()
    proof_urls = {
        m.storage_url
        for m in db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof")
    }
    assert STORED_PROOF_URL in proof_urls
    assert len(proof_urls) == 2

    assert _redact(geo.id, 1, admin_user).status_code == 200

    db.expire_all()
    remaining = db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").all()
    assert len(remaining) == 1
    assert remaining[0].storage_url != STORED_PROOF_URL
    # The image the current body still shows is untouched.
    assert remaining[0].storage_url in json.dumps(db.get(Event, geo.id).proof)


def test_redaction_keeps_a_superseded_source_the_live_proof_still_shows(
    db, author, admin_user, conflict, capture_source_tag, tmp_path, monkeypatch
):
    """A proof body is the third thing that holds a superseded source alive.

    The row went with the correction that replaced it and the last version
    naming it is being blanked, so the live proof body is the only thing left
    pointing at the object. Sweeping it there would punch a hole in the
    published record the redaction never touched.
    """
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    geo = _published(db, author, conflict, capture_source_tag)
    superseded = _source_row(db, geo)
    superseded_url = "http://localhost:8000/local-storage/uploads/e/cited.jpg"
    superseded.storage_url = superseded_url
    superseded_id = str(superseded.id)
    db.commit()
    stored_object = tmp_path / "uploads" / "e" / "cited.jpg"
    stored_object.parent.mkdir(parents=True, exist_ok=True)
    stored_object.write_bytes(TINY_JPEG)

    body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The frame."}]},
            {"type": "image", "attrs": {"src": STORED_PROOF_URL}},
            {"type": "image", "attrs": {"src": superseded_url}},
        ],
    }
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(
                conflict,
                capture_source_tag,
                proof=json.dumps(body),
                remove_media_ids=json.dumps([superseded_id]),
            ),
            files=[_source_part()],
        ).status_code
        == 200
    )
    db.expire_all()
    assert stored_object.exists()

    # Version 1 is the only readable version naming that media, so this is the
    # redaction that would free it if the live body did not display it.
    assert _redact(geo.id, 1, admin_user).status_code == 200
    assert stored_object.exists()


def test_redact_404s_an_unknown_version_or_event(
    db, author, admin_user, conflict, capture_source_tag
):
    geo = _published(db, author, conflict, capture_source_tag)
    assert _redact(geo.id, 1, admin_user).status_code == 404
    assert _redact(uuid.uuid4(), 1, admin_user).status_code == 404
