"""Editing a published event through ``POST /events/{id}/revise``.

A ``geolocated`` row is the vouched record, so a correction files the version it
supersedes instead of overwriting it: ``event_revisions`` gains a snapshot,
``events.revision_no`` moves on, and ``GET /events/{id}/revisions`` reads the
history back. The suite covers the write's four guards (owner, state, the
immutable evidence anchor, the published evidence floor), the media rule that
keeps a past version renderable, and the row lock two concurrent edits
serialize on.

Shared fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` / the proof
helpers in ``_helpers.py``.
"""

from __future__ import annotations

import json
import threading
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventRevision,
)
from app.models.media import Media
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


def _proof_doc(src: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Cross-reference."}]},
            {"type": "image", "attrs": {"src": src}},
        ],
    }


def _published(db, author, conflict, capture_source_tag, **kwargs):
    """A ``geolocated`` row carrying the whole published floor.

    One source media, one stored proof image referenced by the proof body, the
    conflict and the curated capture-source tag: exactly what a revise has to
    keep on the row.
    """
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        with_media=True,
        proof=_proof_doc(STORED_PROOF_URL),
        tags=[capture_source_tag],
        conflicts=[conflict],
        **kwargs,
    )
    db.add(
        Media(
            event_id=geo.id,
            role="proof",
            storage_url=STORED_PROOF_URL,
            media_type="image",
        )
    )
    db.commit()
    db.refresh(geo)
    return geo


def _form(conflict, capture_source_tag, **overrides):
    """The full revise form, keeping the stored proof image; override per test."""
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


def _revise(geo_id, user, **kwargs):
    return client.post(
        f"/api/v1/events/{geo_id}/revise",
        headers=login_as(client, user),
        **kwargs,
    )


def test_revise_snapshots_the_old_version_and_bumps_the_row(
    db, author, conflict, capture_source_tag
):
    """The happy path: the edit lands, the superseded state is filed as version
    1, and the row becomes version 2."""
    geo = _published(db, author, conflict, capture_source_tag, title="Original title")
    assert geo.revision_no == 1

    response = _revise(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, note="Coordinates were off by a block."),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Corrected title"
    assert body["event_coords"] == {"lat": 50.0, "lng": 30.0}
    assert body["revision_no"] == 2
    assert body["status"] == "geolocated"

    db.expire_all()
    rows = db.query(EventRevision).filter(EventRevision.event_id == geo.id).all()
    assert len(rows) == 1
    snapshot_row = rows[0]
    assert snapshot_row.revision_no == 1
    assert snapshot_row.edited_by_id == author.id
    assert snapshot_row.note == "Coordinates were off by a block."
    # The snapshot holds the state BEFORE the edit, which is the whole point.
    assert snapshot_row.snapshot["title"] == "Original title"
    assert snapshot_row.snapshot["event_coords"] == {"lat": 48.5, "lng": 34.5}
    assert snapshot_row.snapshot["proof_media"][0]["storage_url"] == STORED_PROOF_URL
    assert [t["id"] for t in snapshot_row.snapshot["tags"]] == [str(capture_source_tag.id)]


def test_revise_is_owner_only(db, author, second_user, conflict, capture_source_tag):
    """Another analyst cannot correct someone else's record; nothing is filed."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _revise(geo.id, second_user, data=_form(conflict, capture_source_tag))
    assert response.status_code == 403
    db.expire_all()
    assert db.query(EventRevision).filter(EventRevision.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).revision_no == 1


def test_revise_is_geolocated_only(db, author, conflict, capture_source_tag):
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
        response = _revise(geo.id, author, data=_form(conflict, capture_source_tag))
        assert response.status_code == 409, (status, response.text)
        assert response.json()["detail"]["code"] == "invalid_state"


def test_revise_cannot_move_the_evidence_anchor(db, author, conflict, capture_source_tag):
    """``source_url`` and the source media take no field: sending them anyway
    changes nothing, because the endpoint declares neither."""
    geo = _published(db, author, conflict, capture_source_tag)
    source_id = str(next(m.id for m in geo.media if m.role == "source"))
    original_source_url = geo.source_url

    response = _revise(
        geo.id,
        author,
        data=_form(
            conflict,
            capture_source_tag,
            source_url="https://attacker.example/other",
            remove_media_ids=json.dumps([source_id]),
        ),
        files=[("files", ("swap.jpg", b"\xff\xd8\xff\xdb", "image/jpeg"))],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source_url"] == original_source_url
    assert [m["id"] for m in body["media"]] == [source_id]

    db.expire_all()
    refreshed = db.get(Event, geo.id)
    assert refreshed.source_url == original_source_url
    assert [str(m.id) for m in refreshed.media if m.role == "source"] == [source_id]


def test_revise_holds_the_published_floor(db, author, conflict, capture_source_tag):
    """An edit cannot drop a published row below the floor it cleared: dropping
    the conflict is a 400, and the row keeps its version."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _revise(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, conflict_ids=json.dumps([])),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"

    # And the same for an image-less proof body.
    response = _revise(
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
    assert db.get(Event, geo.id).revision_no == 1
    assert db.query(EventRevision).filter(EventRevision.event_id == geo.id).count() == 0


def test_proof_image_a_version_still_shows_is_not_deleted(db, author, conflict, capture_source_tag):
    """The media rule: swapping the proof body for a fresh image drops the old
    one from the current set, but version 1 still shows it, so its row stays."""
    geo = _published(db, author, conflict, capture_source_tag)
    response = _revise(
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
    # current body: without the revision floor the intake would have swept it.
    assert STORED_PROOF_URL in proof_urls
    assert len(proof_urls) == 2


def test_revisions_read_lists_newest_first(db, author, conflict, capture_source_tag):
    """The history endpoint serves the superseded versions, newest first; the
    live row is the current version and is not among them."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    assert (
        _revise(
            geo.id, author, data=_form(conflict, capture_source_tag, title="v2 title")
        ).status_code
        == 200
    )
    assert (
        _revise(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, title="v3 title", note="second"),
        ).status_code
        == 200
    )

    response = client.get(f"/api/v1/events/{geo.id}/revisions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    assert [item["revision_no"] for item in body["items"]] == [2, 1]
    assert [item["snapshot"]["title"] for item in body["items"]] == ["v2 title", "v1 title"]
    assert body["items"][0]["note"] == "second"
    assert body["items"][0]["edited_by"]["username"] == author.username
    assert body["items"][1]["note"] is None


def test_revisions_read_is_empty_before_any_edit(db, author, conflict, capture_source_tag):
    geo = _published(db, author, conflict, capture_source_tag)
    response = client.get(f"/api/v1/events/{geo.id}/revisions")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


def test_revisions_read_404s_an_unknown_event(db, author):
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/revisions").status_code == 404


def test_concurrent_revisions_take_their_number_in_order(db, author, conflict, capture_source_tag):
    """Two edits of the same row at once serialize on the row lock.

    The lock plus ``populate_existing()`` is what makes the second writer read
    the post-lock ``revision_no``: without it both would snapshot version 1 and
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
            c.post(f"/api/v1/events/{geo_id}/revise", headers=headers, data=data).status_code
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
    assert db.get(Event, geo_id).revision_no == 3
    numbers = [
        r.revision_no
        for r in db.query(EventRevision)
        .filter(EventRevision.event_id == geo_id)
        .order_by(EventRevision.revision_no)
    ]
    assert numbers == [1, 2]
