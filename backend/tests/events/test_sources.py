"""Event sources: several per event with levels and kinds, the publish floor, the caps,
the two-layer upload, reuse by copy with its reference-counted storage, archived links, the
derived graphic flag, the source filters, search and the picker."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.event import Event
from app.models.media import Media
from app.models.source import Source
from app.models.upload import Upload
from app.schemas.media import MediaRead
from app.services import uploads as uploads_service
from app.services.storage import get_storage
from tests._fixtures import TINY_JPEG, stored_path
from tests.conftest import login_as
from tests.events._helpers import (
    WORLD_BBOX,
    _make_geo,
    client,
    filed_source,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
    stage_file,
)


def _create(user, conflict, sources: str, **overrides):
    form = {
        "title": "Strike",
        "lat": "48.5",
        "lng": "34.5",
        "occurred_date": "2026-05-01",
        "proof": proof_form_field(),
        "conflict_ids": f'["{conflict.id}"]',
        "sources": sources,
        **overrides,
    }
    return client.post(
        "/api/v1/events",
        headers=login_as(client, user),
        data=form,
        files=[proof_file_part()],
    )


def _key(url: str) -> str:
    key = get_storage().key_from_url(url)
    assert key is not None
    return key


# ── Several sources ──────────────────────────────────────────────────────────


def test_an_event_holds_several_sources_in_level_then_capture_order(author, conflict):
    later = stage_file(author)
    earlier = stage_file(author)
    indirect = stage_file(author)
    sources = sources_field(
        source_spec("https://ctx.example/article", level="context", kind="article"),
        source_spec(
            "https://x.com/a/status/2",
            upload_id=later,
            captured_at="2026-05-01T10:00",
            title="Second angle",
        ),
        source_spec(
            "https://sat.example/after", level="indirect", kind="satellite", upload_id=indirect
        ),
        source_spec(
            "https://t.me/c/1",
            upload_id=earlier,
            kind="drone",
            captured_at="2026-05-01T09:00",
            capture_position={"lat": 48.4, "lng": 34.4},
        ),
    )
    response = _create(author, conflict, sources)
    assert response.status_code == 201, response.text
    read = response.json()["sources"]
    assert [(s["level"], s["links"][0]["url"]) for s in read] == [
        ("direct", "https://t.me/c/1"),
        ("direct", "https://x.com/a/status/2"),
        ("indirect", "https://sat.example/after"),
        ("context", "https://ctx.example/article"),
    ]
    assert read[0]["kind"] == "drone"
    assert read[0]["capture_position"] == {"lat": 48.4, "lng": 34.4}
    assert read[1]["title"] == "Second angle"
    assert read[3]["media"] is None and read[3]["kind"] == "article"
    assert all(s["media"] is not None for s in read[:3])
    # The first source's file is the card thumbnail.
    assert response.json()["thumbnail"]["id"] == read[0]["media"]["id"]


def test_one_url_list_holds_the_same_media_posted_in_several_places(author, conflict):
    sources = sources_field(
        source_spec(
            None,
            upload_id=stage_file(author),
            links=[
                {"url": "https://x.com/a/status/1", "posted_at": "2026-05-01T12:00"},
                {"url": "https://t.me/c/1", "posted_at": "2026-05-01T08:00"},
                {"url": "  "},
                {"url": "https://x.com/a/status/1"},
            ],
        )
    )
    response = _create(author, conflict, sources)
    assert response.status_code == 201, response.text
    links = response.json()["sources"][0]["links"]
    # Blanks and repeats dropped, ordered by post time.
    assert [link["url"] for link in links] == ["https://t.me/c/1", "https://x.com/a/status/1"]


# ── Publish floor ────────────────────────────────────────────────────────────


def test_context_sources_alone_do_not_publish(author, conflict):
    sources = sources_field(source_spec("https://ctx.example", level="context", kind="article"))
    response = _create(author, conflict, sources)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_required"


def test_a_direct_source_without_its_file_does_not_publish(author, conflict):
    response = _create(author, conflict, sources_field(source_spec()))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_file_required"


def test_a_context_source_may_be_a_url_only(author, conflict):
    sources = sources_field(
        source_spec(upload_id=stage_file(author)),
        source_spec("https://news.example/report", level="context", kind="article"),
    )
    assert _create(author, conflict, sources).status_code == 201


def test_every_source_names_its_kind(author, conflict):
    """The kind is required on every source, with or without a file; ``unknown`` counts."""
    for spec in (
        source_spec(upload_id=stage_file(author), kind=None),
        source_spec("https://news.example/report", level="context", kind=None),
    ):
        sources = sources_field(source_spec(upload_id=stage_file(author)), spec)
        assert _create(author, conflict, sources).status_code == 422
    response = _create(author, conflict, filed_source(author, kind="unknown"))
    assert response.status_code == 201, response.text
    assert response.json()["sources"][0]["kind"] == "unknown"


def test_a_request_needs_its_footage(author):
    headers = login_as(client, author)
    without_file = client.post(
        "/api/v1/events/requests",
        headers=headers,
        data={"title": "Where?", "sources": sources_field(source_spec(kind="unknown"))},
    )
    assert without_file.status_code == 400
    assert without_file.json()["detail"]["code"] == "source_file_required"
    with_file = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={"title": "Where?", "sources": filed_source(author, kind="unknown")},
    )
    assert with_file.status_code == 201, with_file.text
    assert with_file.json()["sources"][0]["kind"] == "unknown"


def test_a_source_needs_a_url(author, conflict):
    response = _create(
        author, conflict, sources_field(source_spec(None, upload_id=stage_file(author)))
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_link_required"


def test_a_machine_detection_is_exempt_until_published(db, author):
    """A detection may hold a file-less source (or none); its sources are ``direct``."""
    row = _make_geo(db, author=author, status="detected", kind="unknown")
    assert [(s.level, s.kind, s.media) for s in row.sources] == [("direct", "unknown", None)]
    bare = _make_geo(db, author=author, status="detected", source_url=None)
    assert bare.sources == []


# ── Caps ─────────────────────────────────────────────────────────────────────


def test_more_than_ten_sources_is_refused(author, conflict):
    sources = sources_field(
        source_spec(upload_id=stage_file(author)),
        *(source_spec(f"https://ctx.example/{i}", level="context") for i in range(10)),
    )
    response = _create(author, conflict, sources)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_sources"


def test_more_than_ten_links_on_a_source_is_refused(author, conflict):
    links = [{"url": f"https://mirror.example/{i}"} for i in range(11)]
    sources = sources_field(source_spec(None, upload_id=stage_file(author), links=links))
    response = _create(author, conflict, sources)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_source_links"


def test_a_source_url_must_be_a_web_link(author, conflict):
    response = _create(author, conflict, filed_source(author, url="javascript:alert(1)"))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_source_url"


def test_a_malformed_sources_field_is_a_422(author, conflict):
    response = _create(author, conflict, '[{"level": "primary"}]')
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][:3] == ["body", "sources", 0]


def test_one_source_takes_one_file(author, conflict):
    spec = source_spec(upload_id=stage_file(author), media_id=str(uuid.uuid4()))
    assert _create(author, conflict, sources_field(spec)).status_code == 422


# ── Two-layer upload ─────────────────────────────────────────────────────────


def test_an_upload_is_staged_then_taken_by_the_write(db, author, conflict):
    login_as(client, author)
    staged = client.post(
        "/api/v1/uploads",
        headers=login_as(client, author),
        files={"file": ("strike.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert staged.status_code == 201, staged.text
    body = staged.json()
    assert body["kind"] == "image" and body["original_filename"] == "strike.jpg"
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC) + timedelta(hours=23)
    assert stored_path(_key(body["storage_url"])).exists()

    response = _create(author, conflict, sources_field(source_spec(upload_id=body["id"])))
    assert response.status_code == 201, response.text
    media = response.json()["sources"][0]["media"]
    assert media["storage_url"] == body["storage_url"]
    assert media["original_filename"] == "strike.jpg"
    db.expire_all()
    assert db.get(Upload, uuid.UUID(body["id"])) is None

    # Taken once: a second write naming it finds nothing.
    again = _create(author, conflict, sources_field(source_spec(upload_id=body["id"])))
    assert again.status_code == 400
    assert again.json()["detail"]["code"] == "upload_not_found"


def test_an_upload_is_its_uploaders_alone(author, second_user, conflict):
    upload_id = stage_file(second_user)
    response = _create(author, conflict, sources_field(source_spec(upload_id=upload_id)))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "upload_not_found"


def test_an_unknown_upload_is_refused(author, conflict):
    response = _create(author, conflict, sources_field(source_spec(upload_id=str(uuid.uuid4()))))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "upload_not_found"


def test_an_expired_upload_is_refused_and_reaped(db, author, conflict):
    upload_id = stage_file(author)
    row = db.get(Upload, uuid.UUID(upload_id))
    key = row.storage_key
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    response = _create(author, conflict, sources_field(source_spec(upload_id=upload_id)))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "upload_expired"

    assert stored_path(key).exists()
    assert uploads_service.reap_expired_uploads(db) >= 1
    db.expire_all()
    assert db.get(Upload, uuid.UUID(upload_id)) is None
    assert not stored_path(key).exists()


def test_an_upload_refuses_a_disallowed_type(author):
    response = client.post(
        "/api/v1/uploads",
        headers=login_as(client, author),
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"


def test_staged_uploads_are_capped_per_account(db, author, monkeypatch):
    monkeypatch.setattr(uploads_service, "MAX_PENDING_UPLOADS_PER_USER", 1)
    stage_file(author)
    response = client.post(
        "/api/v1/uploads",
        headers=login_as(client, author),
        files={"file": ("b.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "too_many_uploads"


# ── Reuse by copy ────────────────────────────────────────────────────────────


def _admin_delete(admin, event_id) -> None:
    response = client.delete(
        f"/api/v1/admin/events/{event_id}", params={"hard": "true"}, headers=login_as(client, admin)
    )
    assert response.status_code == 200, response.text


def test_copying_a_source_shares_the_stored_object_until_the_last_row_goes(
    db, author, second_user, admin_user, conflict
):
    first = _create(author, conflict, filed_source(author, is_graphic=True))
    assert first.status_code == 201, first.text
    original = first.json()["sources"][0]
    key = _key(original["media"]["storage_url"])

    picked = client.get(
        "/api/v1/sources", params={"q": "example.com/source"}, headers=login_as(client, second_user)
    )
    assert picked.status_code == 200
    pick = next(s for s in picked.json() if s["id"] == original["id"])
    copy = _create(
        second_user,
        conflict,
        sources_field(source_spec(media_id=pick["media"]["id"], is_graphic=False)),
    )
    assert copy.status_code == 201, copy.text
    copied = copy.json()["sources"][0]
    assert copied["id"] != original["id"]
    assert copied["media"]["id"] != original["media"]["id"]
    assert copied["media"]["storage_url"] == original["media"]["storage_url"]
    # The copy carries the original's graphic flag.
    assert copied["is_graphic"] is True

    _admin_delete(admin_user, first.json()["id"])
    assert stored_path(key).exists()
    _admin_delete(admin_user, copy.json()["id"])
    assert not stored_path(key).exists()


def test_a_hidden_events_file_cannot_be_copied(db, author, second_user, conflict):
    first = _create(author, conflict, filed_source(author))
    media_id = first.json()["sources"][0]["media"]["id"]
    event = db.get(Event, uuid.UUID(first.json()["id"]))
    event.hidden_at = datetime.now(UTC)
    db.commit()
    response = _create(second_user, conflict, sources_field(source_spec(media_id=media_id)))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_media_not_found"


def test_a_request_edit_sweeps_the_file_nothing_names_any_more(db, author):
    created = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={"title": "Where?", "sources": filed_source(author)},
    )
    assert created.status_code == 201, created.text
    source = created.json()["sources"][0]
    key = _key(source["media"]["storage_url"])
    replacement = stage_file(author)
    edited = client.post(
        f"/api/v1/events/{created.json()['id']}/request",
        headers=login_as(client, author),
        data={
            "title": "Where?",
            "sources": sources_field(source_spec(id=source["id"], upload_id=replacement)),
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["sources"][0]["id"] == source["id"]
    assert not stored_path(key).exists()


def test_a_source_kept_by_id_keeps_its_file_and_a_dropped_one_goes(db, author):
    created = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Where?",
            "sources": sources_field(
                source_spec(upload_id=stage_file(author)),
                source_spec("https://ctx.example", level="context"),
            ),
        },
    )
    kept, dropped = created.json()["sources"]
    edited = client.post(
        f"/api/v1/events/{created.json()['id']}/request",
        headers=login_as(client, author),
        data={
            "title": "Where?",
            "sources": sources_field(
                source_spec(id=kept["id"], media_id=kept["media"]["id"], title="Renamed")
            ),
        },
    )
    assert edited.status_code == 200, edited.text
    [only] = edited.json()["sources"]
    assert (only["id"], only["title"], only["media"]["id"]) == (
        kept["id"],
        "Renamed",
        kept["media"]["id"],
    )
    assert db.get(Source, uuid.UUID(dropped["id"])) is None


def test_a_foreign_source_id_is_refused(db, author):
    other = _make_geo(db, author=author)
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Where?",
            "sources": sources_field(
                source_spec(id=str(other.sources[0].id), upload_id=stage_file(author))
            ),
        },
    )
    # A create has no stored sources, so any id names none of them.
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_not_found"


# ── Archived links ───────────────────────────────────────────────────────────


SNAPSHOT = "https://web.archive.org/web/20260501120000/https://example.com/source"


def test_a_link_carries_its_archived_copy(author, conflict):
    response = _create(author, conflict, filed_source(author, snapshot_url=SNAPSHOT))
    assert response.status_code == 201, response.text
    archived = response.json()["sources"][0]["links"][0]["archived"]
    assert archived["url"] == SNAPSHOT and archived["provider"] == "wayback"
    assert archived["archived_at"] is not None


def test_a_paste_that_is_not_a_snapshot_is_refused(author, conflict):
    response = _create(
        author, conflict, filed_source(author, snapshot_url="https://example.com/copy")
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "snapshot_provider_not_allowed"


# ── Graphic flag ─────────────────────────────────────────────────────────────


def test_an_event_is_graphic_when_one_source_is(db, author, conflict):
    sources = sources_field(
        source_spec(upload_id=stage_file(author)),
        source_spec("https://x.com/b", upload_id=stage_file(author), is_graphic=True),
    )
    created = _create(author, conflict, sources)
    assert created.status_code == 201, created.text
    assert created.json()["is_graphic"] is True
    assert [s["is_graphic"] for s in created.json()["sources"]] == [False, True]
    listed = client.get("/api/v1/events", params={"author": author.username})
    assert listed.json()[0]["is_graphic"] is True
    plain = _make_geo(db, author=author)
    assert plain.is_graphic is False
    assert db.query(Event).filter(Event.is_graphic, Event.owner_id == author.id).count() == 1


# ── Filters, search, picker ──────────────────────────────────────────────────


def test_the_source_kind_and_level_filters_narrow_the_lists_and_the_map(db, author):
    drone = _make_geo(db, author=author, kind="drone")
    phone = _make_geo(db, author=author, kind="smartphone")
    for path, extra in (("/api/v1/events", {}), ("/api/v1/events/points", {"bbox": WORLD_BBOX})):
        by_kind = client.get(
            path, params={"source_kind": "drone", "author": author.username, **extra}
        )
        assert by_kind.status_code == 200, by_kind.text
        ids = {row["id"] if isinstance(row, dict) else row[0] for row in by_kind.json()}
        assert str(drone.id) in ids and str(phone.id) not in ids
    by_level = client.get("/api/v1/events", params={"level": "indirect", "author": author.username})
    assert by_level.json() == []
    assert client.get("/api/v1/events", params={"source_kind": "periscope"}).status_code == 422
    assert client.get("/api/v1/events", params={"level": "primary"}).status_code == 422


def test_search_matches_source_titles_and_urls(db, author):
    geo = _make_geo(db, author=author, title="Bridge", source_url="https://t.me/frontline/4242")
    geo.sources[0].title = "Thermal footage"
    db.commit()
    for q in ("thermal", "t.me/frontline/4242"):
        response = client.get("/api/v1/search", params={"q": q, "type": "geolocation"})
        assert response.status_code == 200
        assert str(geo.id) in {hit["id"] for hit in response.json()["geolocations"]}, q


@pytest.mark.parametrize("q", ["t.me/pick", "Night shot"])
def test_the_picker_finds_a_source_by_url_or_title(db, author, second_user, q):
    geo = _make_geo(db, author=author, source_url="https://t.me/pick/1", with_media=True)
    geo.sources[0].title = "Night shot"
    db.commit()
    response = client.get("/api/v1/sources", params={"q": q}, headers=login_as(client, second_user))
    assert response.status_code == 200
    [hit] = [s for s in response.json() if s["event_id"] == str(geo.id)]
    assert hit["event_title"] == geo.title
    assert hit["media"]["id"] == str(geo.sources[0].media.id)


def test_the_picker_skips_withheld_events_and_needs_an_account(db, author, second_user):
    geo = _make_geo(db, author=author, source_url="https://t.me/hidden/1", hidden=True)
    response = client.get(
        "/api/v1/sources", params={"q": "t.me/hidden"}, headers=login_as(client, second_user)
    )
    assert str(geo.id) not in {s["event_id"] for s in response.json()}
    client.cookies.clear()
    assert client.get("/api/v1/sources", params={"q": "t.me/hidden"}).status_code == 401


def test_a_proof_image_is_a_media_row_of_the_event_not_of_a_source(db, author, conflict):
    created = _create(author, conflict, filed_source(author))
    event = db.get(Event, uuid.UUID(created.json()["id"]))
    proof = [m for m in event.media]
    assert len(proof) == 1 and proof[0].source_id is None and proof[0].role == "proof"
    assert db.query(Media).filter(Media.source_id == event.sources[0].id).one().role == "source"


def test_the_media_read_names_a_source_file_and_a_proof_image(db, author, conflict):
    created = _create(author, conflict, filed_source(author))
    assert created.json()["sources"][0]["media"]["role"] == "source"
    event = db.get(Event, uuid.UUID(created.json()["id"]))
    assert [MediaRead.model_validate(m).role for m in event.media] == ["proof"]
