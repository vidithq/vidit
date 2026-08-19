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
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.config import settings
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
from app.models.source_archive import SourceArchive
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)


@pytest.fixture
def admin_user(db):
    user = User(
        username=f"adm{uuid.uuid4().hex[:8]}",
        email=f"adm-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


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
    conflict and the curated capture-source tag: exactly what a revise has to
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

    response = _revise(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, source_snapshot_url=wayback),
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision_no"] == 2
    assert response.json()["archived_source"] == {"url": wayback, "provider": "wayback"}

    db.expire_all()
    rows = db.query(EventRevision).filter(EventRevision.event_id == geo.id).all()
    assert len(rows) == 1
    assert rows[0].snapshot["archives"] == []


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

    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200

    db.expire_all()
    row = db.query(EventRevision).filter(EventRevision.event_id == geo.id).one()
    assert [
        (a["original_url"], a["snapshot_url"], a["provider"]) for a in row.snapshot["archives"]
    ] == [(geo.source_url, wayback, "wayback")]


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


# ── Optional source post time ─────────────────────────────────────────────


def test_revise_accepts_a_row_with_no_source_post_time(db, author, conflict, capture_source_tag):
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
    response = _revise(geo.id, author, data=form)
    assert response.status_code == 200, response.text
    assert response.json()["source_posted_at"] is None
    assert response.json()["revision_no"] == 2

    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at is None
    # An empty string reads the same as an absent field, and a NULL row stays
    # NULL through it.
    assert (
        _revise(
            geo.id, author, data=_form(conflict, capture_source_tag, source_posted_at="")
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
        _revise(
            geo.id, author, data=_form(conflict, capture_source_tag, source_posted_at="")
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at == stored

    # An omitted field reads the same way.
    form = _form(conflict, capture_source_tag)
    del form["source_posted_at"]
    assert _revise(geo.id, author, data=form).status_code == 200
    db.expire_all()
    assert db.get(Event, geo.id).source_posted_at == stored

    # A posted value replaces it.
    response = _revise(
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
        _revise(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, proof=proof_form_field()),
            files=[proof_file_part()],
        ).status_code
        == 200
    )
    # A second edit that changes nothing about the images files version 2.
    assert (
        _revise(geo.id, author, data=_form(conflict, capture_source_tag, title="v3")).status_code
        == 200
    )

    db.expire_all()
    rows = {
        r.revision_no: r for r in db.query(EventRevision).filter(EventRevision.event_id == geo.id)
    }
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
    response = _revise(
        geo.id,
        author,
        data=_form(conflict, capture_source_tag, proof=json.dumps(doc)),
        files=[proof_file_part()],
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "too_many_files"

    db.expire_all()
    assert db.get(Event, geo.id).revision_no == 1
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
        response = _revise(
            geo.id,
            author,
            data=_form(conflict, capture_source_tag, proof=proof_form_field(filename)),
            files=[proof_file_part(filename)],
        )
        assert response.status_code == 200, (filename, response.text)

    db.expire_all()
    assert db.get(Event, geo.id).revision_no == 3
    # Three rows on a one-image cap: the current body displays one, the two
    # versions behind it display the others.
    assert db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").count() == 3


def test_revise_rejects_a_proof_image_belonging_to_another_event(
    db, author, second_user, conflict, capture_source_tag
):
    """A stored image is admitted by its host, but has to be this event's own.

    Embedding another event's proof URL would put that event's owner in charge
    of the file: their next revise or redact drops the row and sweeps the
    object, and this body would render a hole.
    """
    foreign = _published(
        db, second_user, conflict, capture_source_tag, proof_url=OTHER_EVENT_PROOF_URL
    )
    geo = _published(db, author, conflict, capture_source_tag)

    response = _revise(
        geo.id,
        author,
        data=_form(
            conflict, capture_source_tag, proof=json.dumps(_proof_doc(OTHER_EVENT_PROOF_URL))
        ),
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "invalid_file"

    db.expire_all()
    assert db.get(Event, geo.id).revision_no == 1
    assert db.query(EventRevision).filter(EventRevision.event_id == geo.id).count() == 0
    # The other event still owns its image.
    assert db.query(Media).filter(Media.event_id == foreign.id, Media.role == "proof").count() == 1

    # The same body pointing at this event's own stored image is accepted.
    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    db.expire_all()
    assert db.get(Event, geo.id).revision_no == 2


# ── Reading the history ───────────────────────────────────────────────────


def test_revisions_read_is_paged(db, author, conflict, capture_source_tag):
    """A long history walks the shared cursor, and ``total`` stays the whole set."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1")
    for title in ("v2", "v3", "v4"):
        assert (
            _revise(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title)
            ).status_code
            == 200
        )

    first = client.get(f"/api/v1/events/{geo.id}/revisions?limit=2")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 3
    assert [item["revision_no"] for item in body["items"]] == [3, 2]

    link = first.headers["Link"]
    assert link.endswith('; rel="next"')
    cursor = parse_qs(urlparse(link[1 : link.index(">")]).query)["cursor"][0]

    second = client.get(f"/api/v1/events/{geo.id}/revisions?limit=2&cursor={cursor}")
    assert second.status_code == 200, second.text
    assert [item["revision_no"] for item in second.json()["items"]] == [1]
    # The last page names no next one.
    assert "Link" not in second.headers


def test_history_orders_on_the_revision_number_not_the_clock(
    db, author, conflict, capture_source_tag
):
    """``created_at`` is the application's clock, so it skews between instances.

    The list claims ``revision_no`` order, so it reads and pages on that number,
    which one row lock assigns and which no clock can reorder. Version 2 is
    stamped before version 1 here; the history is unmoved.
    """
    geo = _published(db, author, conflict, capture_source_tag, title="v1")
    for title in ("v2", "v3", "v4"):
        assert (
            _revise(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title)
            ).status_code
            == 200
        )

    db.expire_all()
    rows = {
        r.revision_no: r for r in db.query(EventRevision).filter(EventRevision.event_id == geo.id)
    }
    rows[2].created_at = rows[1].created_at - timedelta(days=1)
    db.commit()

    first = client.get(f"/api/v1/events/{geo.id}/revisions?limit=2")
    assert first.status_code == 200, first.text
    assert [item["revision_no"] for item in first.json()["items"]] == [3, 2]

    link = first.headers["Link"]
    cursor = parse_qs(urlparse(link[1 : link.index(">")]).query)["cursor"][0]
    second = client.get(f"/api/v1/events/{geo.id}/revisions?limit=2&cursor={cursor}")
    assert second.status_code == 200, second.text
    assert [item["revision_no"] for item in second.json()["items"]] == [1]


def test_revisions_read_rejects_a_malformed_cursor(db, author, conflict, capture_source_tag):
    """A cursor that does not decode to a version number is a 422, not a 500."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert client.get(f"/api/v1/events/{geo.id}/revisions?cursor=not-a-cursor").status_code == 422


def test_revisions_read_serves_a_withheld_row_to_an_admin_only(
    db, author, admin_user, conflict, capture_source_tag
):
    """A takedown hides the history from everyone but an admin, who has to read
    what was taken down in order to judge the report that took it down."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert client.get(f"/api/v1/events/{geo.id}/revisions").status_code == 404
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/revisions", headers=login_as(client, author)
        ).status_code
        == 404
    )
    response = client.get(
        f"/api/v1/events/{geo.id}/revisions", headers=login_as(client, admin_user)
    )
    assert response.status_code == 200, response.text
    assert [item["revision_no"] for item in response.json()["items"]] == [1]


def test_one_revision_reads_by_its_number(db, author, conflict, capture_source_tag):
    """The direct read behind ``/vN``: one version, without walking the list."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    for title in ("v2 title", "v3 title"):
        assert (
            _revise(
                geo.id, author, data=_form(conflict, capture_source_tag, title=title, note=title)
            ).status_code
            == 200
        )

    response = client.get(f"/api/v1/events/{geo.id}/revisions/1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["revision_no"] == 1
    assert body["snapshot"]["title"] == "v1 title"
    assert body["note"] == "v2 title"
    assert body["edited_by"]["username"] == author.username
    assert body["redacted"] is False

    assert client.get(f"/api/v1/events/{geo.id}/revisions/2").json()["snapshot"]["title"] == (
        "v2 title"
    )


def test_one_revision_404s_outside_the_filed_history(db, author, conflict, capture_source_tag):
    """The live row is the current version and is not filed, so its own number
    answers 404 here; so does a number the event never carried, and an unknown
    event."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200

    assert client.get(f"/api/v1/events/{geo.id}/revisions/2").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/revisions/9").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/revisions/0").status_code == 404
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/revisions/1").status_code == 404


def test_one_revision_serves_a_redacted_version_blanked(
    db, author, admin_user, conflict, capture_source_tag
):
    """A redacted version is not a missing one: the address stays, and the page
    it serves is the blanked row rather than a 404."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert (
        _revise(geo.id, author, data=_form(conflict, capture_source_tag, note="why")).status_code
        == 200
    )
    assert _redact(geo.id, 1, admin_user).status_code == 200

    response = client.get(f"/api/v1/events/{geo.id}/revisions/1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["redacted"] is True
    assert body["snapshot"] == {}
    assert body["note"] is None
    assert body["edited_by"]["username"] == author.username


def test_one_revision_serves_a_withheld_row_to_an_admin_only(
    db, author, admin_user, conflict, capture_source_tag
):
    """The direct read takes the same takedown branch as the list."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert client.get(f"/api/v1/events/{geo.id}/revisions/1").status_code == 404
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/revisions/1", headers=login_as(client, author)
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/events/{geo.id}/revisions/1", headers=login_as(client, admin_user)
        ).status_code
        == 200
    )


# ── Redaction ─────────────────────────────────────────────────────────────


def _redact(geo_id, revision_no, user):
    return client.post(
        f"/api/v1/admin/events/{geo_id}/revisions/{revision_no}/redact",
        headers=login_as(client, user),
    )


def test_redact_is_admin_only(db, author, conflict, capture_source_tag):
    """The owner cannot blank their own history; only an admin can."""
    geo = _published(db, author, conflict, capture_source_tag)
    assert _revise(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200

    assert _redact(geo.id, 1, author).status_code == 403
    db.expire_all()
    row = db.query(EventRevision).filter(EventRevision.event_id == geo.id).one()
    assert row.redacted_at is None
    assert row.snapshot != {}


def test_redact_blanks_the_version_and_keeps_its_number(
    db, author, admin_user, conflict, capture_source_tag
):
    """The content goes, the row and its address stay, and a second call is a
    no-op rather than a second redaction."""
    geo = _published(db, author, conflict, capture_source_tag, title="v1 title")
    assert (
        _revise(geo.id, author, data=_form(conflict, capture_source_tag, note="why")).status_code
        == 200
    )

    response = _redact(geo.id, 1, admin_user)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["redacted"] is True
    assert body["revision_no"] == 1
    assert body["snapshot"] == {}
    assert body["note"] is None
    assert body["edited_by"]["username"] == author.username

    db.expire_all()
    row = db.query(EventRevision).filter(EventRevision.event_id == geo.id).one()
    first_stamp = row.redacted_at
    assert first_stamp is not None
    assert row.redacted_by_id == admin_user.id

    # Idempotent: the second call changes nothing.
    assert _redact(geo.id, 1, admin_user).status_code == 200
    db.expire_all()
    assert db.query(EventRevision).filter(EventRevision.event_id == geo.id).one().redacted_at == (
        first_stamp
    )

    # The history still lists the version, marked, so ``/vN`` never shifts.
    listing = client.get(f"/api/v1/events/{geo.id}/revisions").json()
    assert listing["total"] == 1
    assert listing["items"][0]["revision_no"] == 1
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
        _revise(
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


def test_redact_404s_an_unknown_version_or_event(
    db, author, admin_user, conflict, capture_source_tag
):
    geo = _published(db, author, conflict, capture_source_tag)
    assert _redact(geo.id, 1, admin_user).status_code == 404
    assert _redact(uuid.uuid4(), 1, admin_user).status_code == 404
