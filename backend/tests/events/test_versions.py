"""Editing a published event through ``POST /events/{id}/versions``.

A correction files the version it supersedes instead of overwriting it. Covers the
write's guards (owner, state, published floor), the corrections it files (the sources
included), the media rules that keep a past version renderable, and the row lock two
concurrent edits serialize on.
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
    EventVersion,
)
from app.models.media import Media
from app.models.source import SourceLink
from app.services import versions as versions_service
from app.services.storage import get_storage
from tests._fixtures import fake_sha256, stored_path
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    filed_source,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
    stage_file,
)

# A stored proof image on the dev media host the sanitiser admits.
STORED_PROOF_URL = "http://localhost:8000/local-storage/proof/u/stored.jpg"

# A second stored image on the same host, standing in for another event's.
OTHER_EVENT_PROOF_URL = "http://localhost:8000/local-storage/proof/u/other-event.jpg"

SOURCE_URL = "https://example.com/source"
WAYBACK = f"https://web.archive.org/web/20260811120000/{SOURCE_URL}"


def _proof_html(src: str) -> str:
    return f'<p>Cross-reference.</p><img src="{src}">'


def _published(db, author, conflict, *, proof_url=STORED_PROOF_URL, **kwargs):
    """A ``geolocated`` row carrying the whole published floor an edit has to keep."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_GEOLOCATED,
        with_media=True,
        proof=_proof_html(proof_url),
        conflicts=[conflict],
        **kwargs,
    )
    db.add(Media(sha256=fake_sha256(), event_id=geo.id, storage_url=proof_url, kind="image"))
    db.commit()
    db.refresh(geo)
    return geo


def _keep(source_id, media_id, url=SOURCE_URL, **kw):
    """A stored source re-posted by ``id`` with its own file, as the edit form sends it."""
    return source_spec(url, id=str(source_id), media_id=str(media_id), **kw)


def _kept(geo, **kw) -> str:
    """The ``sources`` field re-posting the one stored source of a :func:`_published` row."""
    [source] = geo.sources
    return sources_field(_keep(source.id, source.media.id, **kw))


def _form(conflict, sources: str, **overrides):
    """The full edit form, keeping the stored proof image; override per test."""
    form = {
        "title": "Corrected title",
        "lat": "50.0",
        "lng": "30.0",
        "occurred_date": "2026-05-02",
        "proof": _proof_html(STORED_PROOF_URL),
        "conflict_ids": json.dumps([str(conflict.id)]),
        "sources": sources,
    }
    form.update(overrides)
    return form


def _save_version(geo_id, user, **kwargs):
    return client.post(
        f"/api/v1/events/{geo_id}/versions",
        headers=login_as(client, user),
        **kwargs,
    )


def _publish(user, conflict, sources: str) -> dict:
    """``POST /events``: a published event whose files sit in the local storage root."""
    response = client.post(
        "/api/v1/events",
        headers=login_as(client, user),
        data={
            "title": "Strike",
            "lat": "48.5",
            "lng": "34.5",
            "occurred_date": "2026-05-01",
            "proof": proof_form_field(),
            "conflict_ids": json.dumps([str(conflict.id)]),
            "sources": sources,
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _key(url: str) -> str:
    key = get_storage().key_from_url(url)
    assert key is not None
    return key


def _filed(db, geo_id) -> EventVersion:
    db.expire_all()
    return db.query(EventVersion).filter(EventVersion.event_id == geo_id).one()


def test_save_version_snapshots_the_old_version_and_bumps_the_row(db, author, conflict, free_tag):
    """The edit lands, the superseded state is filed as version 1, the row becomes version 2."""
    geo = _published(db, author, conflict, title="Original title", tags=[free_tag])
    [source] = geo.sources
    assert geo.version_no == 1

    response = _save_version(
        geo.id,
        author,
        data=_form(
            conflict,
            _kept(geo),
            tag_ids=json.dumps([str(free_tag.id)]),
            note="Coordinates were off by a block.",
        ),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Corrected title"
    assert body["coords"] == {"lat": 50.0, "lng": 30.0}
    assert body["version_no"] == 2
    assert body["status"] == "geolocated"
    # A source kept by ``id`` with its ``media_id`` keeps its row and its file.
    assert [(s["id"], s["media"]["id"]) for s in body["sources"]] == [
        (str(source.id), str(source.media.id))
    ]

    snapshot_row = _filed(db, geo.id)
    assert snapshot_row.version_no == 1
    assert snapshot_row.edited_by_id == author.id
    assert snapshot_row.note == "Coordinates were off by a block."
    # The snapshot holds the state BEFORE the edit.
    assert snapshot_row.snapshot["title"] == "Original title"
    assert snapshot_row.snapshot["coords"] == {"lat": 48.5, "lng": 34.5}
    assert snapshot_row.snapshot["proof_media"][0]["storage_url"] == STORED_PROOF_URL
    assert [t["id"] for t in snapshot_row.snapshot["tags"]] == [str(free_tag.id)]
    [filed_source_entry] = snapshot_row.snapshot["sources"]
    assert filed_source_entry["links"][0]["url"] == SOURCE_URL
    assert filed_source_entry["media"]["id"] == str(source.media.id)


# ── Source corrections ───────────────────────────────────────────────────────


SOURCE_CHANGES = {
    "title": ({"title": "Second angle"}, lambda s: s["title"]),
    "level": ({"level": "indirect"}, lambda s: s["level"]),
    "sensor": ({"sensor": "drone"}, lambda s: s["sensor"]),
    "links": ({"url": "https://t.me/c/9"}, lambda s: [link["url"] for link in s["links"]]),
    "file": ({"upload": True}, lambda s: s["media"]["id"]),
}


@pytest.mark.parametrize("change", sorted(SOURCE_CHANGES))
def test_a_source_correction_alone_files_the_superseded_source(db, author, conflict, change):
    """A save moving one field of one source is a change, and the version keeps the old source."""
    edit, read = SOURCE_CHANGES[change]
    geo = _published(db, author, conflict)
    # Bring the row to exactly what the form posts, so the next save moves only the source.
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200
    before = client.get(f"/api/v1/events/{geo.id}").json()["sources"][0]

    [source] = geo.sources
    edit = dict(edit)
    if edit.pop("upload", False):
        spec = source_spec(id=str(source.id), upload_id=stage_file(author))
    else:
        spec = _keep(source.id, source.media.id, **edit)
    response = _save_version(geo.id, author, data=_form(conflict, sources_field(spec)))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 3
    [after] = response.json()["sources"]
    assert after["id"] == str(source.id)
    assert read(after) != read(before)

    db.expire_all()
    filed = (
        db.query(EventVersion)
        .filter(EventVersion.event_id == geo.id, EventVersion.version_no == 2)
        .one()
    )
    [superseded] = filed.snapshot["sources"]
    assert read(superseded) == read(before)


def test_a_graphic_source_stays_graphic_through_an_edit(db, author, conflict):
    """The flag ratchets: an edit posting false keeps a flagged source flagged."""
    geo = _published(db, author, conflict, is_graphic=True)
    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo, is_graphic=False)))
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True
    assert response.json()["sources"][0]["is_graphic"] is True


def test_a_version_cannot_leave_the_record_without_footage(db, author, conflict):
    """Dropping the file, or every direct and indirect source, fails the published floor."""
    geo = _published(db, author, conflict)
    [source] = geo.sources

    without_file = source_spec(id=str(source.id))
    context_only = source_spec("https://news.example/report", level="context", sensor=None)
    for spec, code in ((without_file, "source_file_required"), (context_only, "source_required")):
        response = _save_version(geo.id, author, data=_form(conflict, sources_field(spec)))
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == code

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.get(Event, geo.id).sources[0].media is not None


def test_a_source_without_a_url_is_refused(db, author, conflict):
    """A blank URL leaves the source with none, and every posted source needs one."""
    geo = _published(db, author, conflict)
    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo, url="   ")))
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "source_link_required"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1


@pytest.mark.parametrize("how", ["replaced", "dropped"])
def test_a_superseded_source_file_outlives_its_row_until_the_last_version_naming_it_goes(
    db, author, admin_user, conflict, how
):
    """A replaced or dropped file stays stored while a readable version renders it.

    Redacting the last version that names it frees the object.
    """
    body = _publish(
        author,
        conflict,
        sources_field(
            source_spec(upload_id=stage_file(author)),
            source_spec("https://x.com/b", upload_id=stage_file(author)),
        ),
    )
    first, second = body["sources"]
    target = first if how == "replaced" else second
    old_url = target["media"]["storage_url"]
    key = _key(old_url)

    if how == "replaced":
        sources = sources_field(
            source_spec(id=first["id"], upload_id=stage_file(author)),
            _keep(second["id"], second["media"]["id"], url="https://x.com/b"),
        )
    else:
        sources = sources_field(_keep(first["id"], first["media"]["id"]))
    response = _save_version(body["id"], author, data=_form(conflict, sources, proof=body["proof"]))
    assert response.status_code == 200, response.text
    assert old_url not in {s["media"]["storage_url"] for s in response.json()["sources"]}

    db.expire_all()
    assert db.query(Media).filter(Media.id == uuid.UUID(target["media"]["id"])).count() == 0
    assert stored_path(key).exists()
    served = client.get(f"/api/v1/events/{body['id']}/versions/1").json()
    assert old_url in {s["media"]["storage_url"] for s in served["snapshot"]["sources"]}

    assert _redact(body["id"], 1, admin_user).status_code == 200
    assert not stored_path(key).exists()


# ── Archived copies ──────────────────────────────────────────────────────────


def test_recording_a_links_archived_copy_files_one_version(db, author, conflict):
    """The snapshot is filed before the write applies: the superseded version holds no copy and
    the live link the new one."""
    geo = _published(db, author, conflict)

    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo, snapshot_url=WAYBACK)))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2
    archived = response.json()["sources"][0]["links"][0]["archived"]
    assert (archived["url"], archived["provider"]) == (WAYBACK, "wayback")

    filed = _filed(db, geo.id)
    assert filed.snapshot["sources"][0]["links"][0]["snapshot_url"] is None


def test_a_new_archived_copy_is_a_change_and_the_same_one_is_not(db, author, conflict):
    """A copy the link does not hold yet is a change; re-posting the one it holds is not."""
    geo = _published(db, author, conflict, title="Original title")
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200

    data = _form(conflict, _kept(geo, snapshot_url=WAYBACK))
    assert _save_version(geo.id, author, data=data).status_code == 200

    response = _save_version(geo.id, author, data=data)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 3


def test_a_non_canonical_re_paste_of_the_stored_copy_is_no_change(db, author, conflict):
    """A trailing slash added in a browser names the same capture, so the save is refused."""
    geo = _published(db, author, conflict)
    data = _form(conflict, _kept(geo, snapshot_url=WAYBACK))
    assert _save_version(geo.id, author, data=data).status_code == 200

    data["sources"] = _kept(geo, snapshot_url=f"{WAYBACK}/")
    response = _save_version(geo.id, author, data=data)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_a_replaced_link_leaves_its_archived_copy_in_the_version(db, author, conflict):
    """A copy recorded against a link the edit replaces is not carried to the new link; the
    superseded version still holds it, so ``/v1`` renders it."""
    geo = _published(db, author, conflict)
    link = geo.sources[0].links[0]
    link.snapshot_url = WAYBACK
    link.archived_at = datetime.now(UTC)
    db.commit()

    response = _save_version(
        geo.id, author, data=_form(conflict, _kept(geo, url="https://example.com/original"))
    )
    assert response.status_code == 200, response.text
    [live] = response.json()["sources"][0]["links"]
    assert (live["url"], live["archived"]) == ("https://example.com/original", None)

    filed = _filed(db, geo.id)
    [old] = filed.snapshot["sources"][0]["links"]
    assert (old["url"], old["snapshot_url"]) == (SOURCE_URL, WAYBACK)


def test_save_version_refuses_a_snapshot_that_is_not_one(db, author, conflict):
    """A paste that is not a snapshot address is a 400 and files no version."""
    geo = _published(db, author, conflict)

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, _kept(geo, snapshot_url=f"https://archive.ph/newest/{SOURCE_URL}")),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_not_a_snapshot_code"

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == 1


# ── Guards ───────────────────────────────────────────────────────────────────


def test_save_version_is_owner_only(db, author, second_user, conflict):
    """Another analyst cannot correct someone else's record; nothing is filed."""
    geo = _published(db, author, conflict)
    response = _save_version(geo.id, second_user, data=_form(conflict, _kept(geo)))
    assert response.status_code == 403
    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == 1


def test_save_version_is_geolocated_only(db, author, conflict):
    """Before publication there is no vouched version to supersede: other states answer 409."""
    for status in (STATUS_DETECTED, STATUS_REQUESTED, STATUS_CLOSED):
        geo = _make_geo(
            db,
            author=author,
            status=status,
            with_media=True,
            proof=_proof_html(STORED_PROOF_URL),
            conflicts=[conflict],
        )
        response = _save_version(geo.id, author, data=_form(conflict, _kept(geo)))
        assert response.status_code == 409, (status, response.text)
        assert response.json()["detail"]["code"] == "invalid_state"


def test_save_version_holds_the_published_floor(db, author, conflict):
    """An edit cannot drop a published row below its floor: the conflict and the proof image."""
    geo = _published(db, author, conflict)
    response = _save_version(
        geo.id, author, data=_form(conflict, _kept(geo), conflict_ids=json.dumps([]))
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "conflict_required"

    response = _save_version(
        geo.id, author, data=_form(conflict, _kept(geo), proof="<p>No image.</p>")
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0


# ── Proof images ─────────────────────────────────────────────────────────────


def _proof_rows(db, geo_id):
    return db.query(Media).filter(Media.event_id == geo_id)


def test_proof_image_a_version_still_shows_is_not_deleted(db, author, conflict):
    """A fresh proof image drops the old one from the current set, but version 1 still shows it."""
    geo = _published(db, author, conflict)
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, _kept(geo), proof=proof_form_field()),
        files=[proof_file_part()],
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    proof_urls = {m.storage_url for m in _proof_rows(db, geo.id)}
    # Without the version floor the intake would have swept the referenced image.
    assert STORED_PROOF_URL in proof_urls
    assert len(proof_urls) == 2


def test_snapshot_lists_only_the_images_that_version_displayed(db, author, conflict):
    """``proof_media`` is the version's own body, not every proof row on the row.

    Version 2's snapshot claims the new image alone: claiming the old one too would
    misreport what it showed and pin the image past the last version displaying it.
    """
    geo = _published(db, author, conflict)
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, _kept(geo), proof=proof_form_field()),
            files=[proof_file_part()],
        ).status_code
        == 200
    )
    db.expire_all()
    new_proof = db.get(Event, geo.id).proof
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, _kept(geo), title="v3", proof=new_proof)
        ).status_code
        == 200
    )

    db.expire_all()
    rows = {r.version_no: r for r in db.query(EventVersion).filter(EventVersion.event_id == geo.id)}
    assert [m["storage_url"] for m in rows[1].snapshot["proof_media"]] == [STORED_PROOF_URL]
    v2_urls = [m["storage_url"] for m in rows[2].snapshot["proof_media"]]
    assert STORED_PROOF_URL not in v2_urls
    assert len(v2_urls) == 1
    assert _proof_rows(db, geo.id).count() == 2


def test_proof_image_cap_counts_what_the_new_body_displays(db, author, conflict, monkeypatch):
    """The ceiling is on the post-write body, not on one request.

    One kept image plus one upload is two on a one-image cap, refused before anything
    reaches S3.
    """
    monkeypatch.setattr(settings, "max_proof_images_per_event", 1)
    geo = _published(db, author, conflict)

    proof = _proof_html(STORED_PROOF_URL) + '<img src="placeholder://proof-1.jpg">'
    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, _kept(geo), proof=proof),
        files=[proof_file_part()],
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "too_many_files"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert _proof_rows(db, geo.id).count() == 1


def test_history_pinned_images_do_not_consume_the_cap(db, author, conflict, monkeypatch):
    """An image kept only so an old version renders is not charged to the owner.

    Counting superseded rows would make swapping an image spend the quota permanently.
    """
    monkeypatch.setattr(settings, "max_proof_images_per_event", 1)
    geo = _published(db, author, conflict)

    for filename in ("proof-1.jpg", "proof-2.jpg"):
        response = _save_version(
            geo.id,
            author,
            data=_form(conflict, _kept(geo), proof=proof_form_field(filename)),
            files=[proof_file_part(filename)],
        )
        assert response.status_code == 200, (filename, response.text)

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 3
    # Three rows on a one-image cap: the body displays one, the versions behind it the others.
    assert _proof_rows(db, geo.id).count() == 3


def test_save_version_rejects_a_proof_image_belonging_to_another_event(
    db, author, second_user, conflict
):
    """A stored image is admitted by its host, but has to be this event's own.

    Another event's proof URL would put its owner in charge of the file: their next edit
    or redact sweeps the object.
    """
    foreign = _published(db, second_user, conflict, proof_url=OTHER_EVENT_PROOF_URL)
    geo = _published(db, author, conflict)

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, _kept(geo), proof=_proof_html(OTHER_EVENT_PROOF_URL)),
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "invalid_file"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 1
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert _proof_rows(db, foreign.id).count() == 1

    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200
    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_a_proof_body_may_cite_the_events_own_source_file(db, author, conflict):
    """Ownership is per event, not per role.

    A proof body may show a frame of one of the event's source files, which dies only with
    that event.
    """
    geo = _published(db, author, conflict)
    source_file = geo.sources[0].media
    # On the media host, so ownership is the only check left to decide.
    source_file.storage_url = "http://localhost:8000/local-storage/uploads/e/source.jpg"
    db.commit()

    body = f'<p>The frame.</p><img src="{STORED_PROOF_URL}"><img src="{source_file.storage_url}">'
    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo), proof=body))
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(Media).filter(Media.id == source_file.id).count() == 1


def test_a_proof_may_cite_a_superseded_source_file_which_redaction_then_keeps(
    db, author, admin_user, conflict
):
    """Ownership and storage survive the replacement that deletes the file's row.

    The version's snapshot still names the file, so a later edit of that body is accepted;
    once the last version naming it is redacted, the live proof body alone holds it, and
    sweeping it would punch a hole in the record.
    """
    body = _publish(author, conflict, filed_source(author))
    [source] = body["sources"]
    old_url = source["media"]["storage_url"]
    key = _key(old_url)
    cited = body["proof"] + f'<p>The frame.</p><img src="{old_url}">'

    replaced = _save_version(
        body["id"],
        author,
        data=_form(
            conflict,
            sources_field(source_spec(id=source["id"], upload_id=stage_file(author))),
            proof=cited,
        ),
    )
    assert replaced.status_code == 200, replaced.text
    [new] = replaced.json()["sources"]
    db.expire_all()
    assert db.query(Media).filter(Media.id == uuid.UUID(source["media"]["id"])).count() == 0

    again = _save_version(
        body["id"],
        author,
        data=_form(
            conflict,
            sources_field(_keep(new["id"], new["media"]["id"])),
            title="Second correction",
            proof=replaced.json()["proof"],
        ),
    )
    assert again.status_code == 200, again.text
    assert stored_path(key).exists()

    assert _redact(body["id"], 1, admin_user).status_code == 200
    assert stored_path(key).exists()


# ── Change detection and the ceiling ─────────────────────────────────────────


def test_an_edit_that_moves_nothing_is_refused(db, author, conflict):
    """Re-posting the state the row already holds is a 409 and files nothing.

    The form posts the whole editable state, so an untouched save would otherwise mint a
    version with an empty changed-field list.
    """
    geo = _published(db, author, conflict, title="Original title")
    # One real edit first, so the row holds exactly what this form posts.
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200

    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo)))
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 1
    assert db.get(Event, geo.id).version_no == 2


def test_a_note_alone_does_not_make_a_version(db, author, conflict):
    """The note annotates a change; on its own there is none to annotate."""
    geo = _published(db, author, conflict, title="Original title")
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200

    response = _save_version(
        geo.id, author, data=_form(conflict, _kept(geo), note="Checked it again.")
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nothing_changed"

    db.expire_all()
    assert db.get(Event, geo.id).version_no == 2


def test_an_event_stops_at_the_version_ceiling(db, author, conflict):
    """Version 100 is the last an edit can produce, and the refusal does not point at an admin."""
    geo = _published(db, author, conflict)
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo), title="One more"))
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "version_limit"
    assert response.json()["detail"]["message"] == (
        "This event has reached 100 versions and can no longer be edited."
    )

    db.expire_all()
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0
    assert db.get(Event, geo.id).version_no == versions_service.MAX_VERSIONS_PER_EVENT


def test_a_save_that_only_archives_passes_the_ceiling(db, author, conflict):
    """Preserving evidence never waits on a quota.

    A save whose only change is an archived copy files version 101 at the ceiling,
    else a link dying at version 100 could never be archived.
    """
    geo = _published(db, author, conflict)
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200
    db.expire_all()
    geo = db.get(Event, geo.id)
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(geo.id, author, data=_form(conflict, _kept(geo, snapshot_url=WAYBACK)))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == versions_service.MAX_VERSIONS_PER_EVENT + 1
    assert response.json()["sources"][0]["links"][0]["archived"]["url"] == WAYBACK


def test_an_edit_carrying_a_copy_still_meets_the_ceiling(db, author, conflict):
    """The exemption is for a save that ONLY archives; a correction that moves a field stops."""
    geo = _published(db, author, conflict)
    geo.version_no = versions_service.MAX_VERSIONS_PER_EVENT
    db.commit()

    response = _save_version(
        geo.id,
        author,
        data=_form(conflict, _kept(geo, snapshot_url=WAYBACK), title="One more"),
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "version_limit"

    db.expire_all()
    link = db.query(SourceLink).filter(SourceLink.source_id == geo.sources[0].id).one()
    assert link.snapshot_url is None


def test_concurrent_versions_take_their_number_in_order(db, author, conflict):
    """Two edits of the same row at once serialize on the row lock.

    The lock plus ``populate_existing()`` makes the second writer read the post-lock
    ``version_no``; without it both snapshot version 1 and the unique constraint 500s.
    """
    geo = _published(db, author, conflict)
    geo_id = geo.id
    sources = _kept(geo)

    statuses: list[int] = []
    barrier = threading.Barrier(2)

    def worker(title: str) -> None:
        c = TestClient(app)
        headers = login_as(c, author)
        data = _form(conflict, sources, title=title)
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


# ── History reads ────────────────────────────────────────────────────────────


def _edit_titles(geo, author, conflict, *titles: str, note: bool = False) -> None:
    for title in titles:
        extra = {"note": title} if note else {}
        response = _save_version(
            geo.id, author, data=_form(conflict, _kept(geo), title=title, **extra)
        )
        assert response.status_code == 200, response.text


def test_versions_read_lists_newest_first(db, author, conflict):
    """The history serves the superseded versions newest first; the live row is not among them."""
    geo = _published(db, author, conflict, title="v1 title")
    _edit_titles(geo, author, conflict, "v2 title")
    assert (
        _save_version(
            geo.id, author, data=_form(conflict, _kept(geo), title="v3 title", note="second")
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


def test_versions_read_is_empty_before_any_edit(db, author, conflict):
    geo = _published(db, author, conflict)
    response = client.get(f"/api/v1/events/{geo.id}/versions")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


def test_versions_read_404s_an_unknown_event(db, author):
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/versions").status_code == 404


def test_versions_read_is_paged(db, author, conflict):
    """A long history walks the shared cursor, and ``total`` stays the whole set."""
    geo = _published(db, author, conflict, title="v1")
    _edit_titles(geo, author, conflict, "v2", "v3", "v4")

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
    assert "Link" not in second.headers


def test_history_orders_on_the_version_number_not_the_clock(db, author, conflict):
    """``created_at`` is the application's clock and skews between instances.

    The list reads and pages on ``version_no``, which one row lock assigns. Version 2 is
    stamped before version 1 here; the history is unmoved.
    """
    geo = _published(db, author, conflict, title="v1")
    _edit_titles(geo, author, conflict, "v2", "v3", "v4")

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


def test_versions_read_rejects_a_malformed_cursor(db, author, conflict):
    """A cursor that does not decode to a version number is a 422, not a 500."""
    geo = _published(db, author, conflict)
    assert client.get(f"/api/v1/events/{geo.id}/versions?cursor=not-a-cursor").status_code == 422


def test_versions_read_serves_a_withheld_row_to_an_admin_only(db, author, admin_user, conflict):
    """A takedown hides the history from all but an admin, who must read what was taken down."""
    geo = _published(db, author, conflict)
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200
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


def test_one_version_reads_by_its_number(db, author, conflict):
    """The direct read behind ``/vN``: one version, without walking the list."""
    geo = _published(db, author, conflict, title="v1 title")
    _edit_titles(geo, author, conflict, "v2 title", "v3 title", note=True)

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


def test_one_version_404s_outside_the_filed_history(db, author, conflict):
    """The live row's number, a number never carried, and an unknown event all answer 404."""
    geo = _published(db, author, conflict)
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200

    assert client.get(f"/api/v1/events/{geo.id}/versions/2").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/versions/9").status_code == 404
    assert client.get(f"/api/v1/events/{geo.id}/versions/0").status_code == 404
    assert client.get(f"/api/v1/events/{uuid.uuid4()}/versions/1").status_code == 404


def test_one_version_serves_a_redacted_version_blanked(db, author, admin_user, conflict):
    """A redacted version is not a missing one: the page serves the blanked row, not a 404."""
    geo = _published(db, author, conflict)
    assert (
        _save_version(geo.id, author, data=_form(conflict, _kept(geo), note="why")).status_code
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


def test_one_version_serves_a_withheld_row_to_an_admin_only(db, author, admin_user, conflict):
    """The direct read takes the same takedown branch as the list."""
    geo = _published(db, author, conflict)
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200
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


# ── Redaction ────────────────────────────────────────────────────────────────


def _redact(geo_id, version_no, user):
    return client.post(
        f"/api/v1/admin/events/{geo_id}/versions/{version_no}/redact",
        headers=login_as(client, user),
    )


def test_redact_is_admin_only(db, author, conflict):
    """The owner cannot blank their own history; only an admin can."""
    geo = _published(db, author, conflict)
    assert _save_version(geo.id, author, data=_form(conflict, _kept(geo))).status_code == 200

    assert _redact(geo.id, 1, author).status_code == 403
    row = _filed(db, geo.id)
    assert row.redacted_at is None
    assert row.snapshot != {}


def test_redact_blanks_the_version_and_keeps_its_number(db, author, admin_user, conflict):
    """The content goes, the row and its number stay, and a second call is a no-op."""
    geo = _published(db, author, conflict, title="v1 title")
    assert (
        _save_version(geo.id, author, data=_form(conflict, _kept(geo), note="why")).status_code
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

    row = _filed(db, geo.id)
    first_stamp = row.redacted_at
    assert first_stamp is not None
    assert row.redacted_by_id == admin_user.id

    assert _redact(geo.id, 1, admin_user).status_code == 200
    assert _filed(db, geo.id).redacted_at == first_stamp

    listing = client.get(f"/api/v1/events/{geo.id}/versions").json()
    assert listing["total"] == 1
    assert listing["items"][0]["version_no"] == 1
    assert listing["items"][0]["redacted"] is True
    assert listing["items"][0]["snapshot"] == {}


def test_redact_frees_the_image_only_that_version_displayed(db, author, admin_user, conflict):
    """A redacted version holds no images: one no readable version or body points at goes."""
    geo = _published(db, author, conflict)
    # Version 1's snapshot is the only thing still pointing at the stored image.
    assert (
        _save_version(
            geo.id,
            author,
            data=_form(conflict, _kept(geo), proof=proof_form_field()),
            files=[proof_file_part()],
        ).status_code
        == 200
    )
    db.expire_all()
    proof_urls = {m.storage_url for m in _proof_rows(db, geo.id)}
    assert STORED_PROOF_URL in proof_urls
    assert len(proof_urls) == 2

    assert _redact(geo.id, 1, admin_user).status_code == 200

    db.expire_all()
    remaining = _proof_rows(db, geo.id).all()
    assert len(remaining) == 1
    assert remaining[0].storage_url != STORED_PROOF_URL
    assert remaining[0].storage_url in db.get(Event, geo.id).proof


def test_redact_404s_an_unknown_version_or_event(db, author, admin_user, conflict):
    geo = _published(db, author, conflict)
    assert _redact(geo.id, 1, admin_user).status_code == 404
    assert _redact(uuid.uuid4(), 1, admin_user).status_code == 404
