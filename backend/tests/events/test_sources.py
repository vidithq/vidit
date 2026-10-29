"""Event sources: several per event with levels and kinds, the publish floor, the caps,
the two-layer upload, a file named by id, archived links, the derived graphic flag,
the source filters and search."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO

from PIL import Image

from app.config import settings
from app.models.event import Event
from app.models.media import Media
from app.models.source import Source
from app.models.upload import Upload
from app.schemas.media import MediaRead
from app.services import uploads as uploads_service
from app.services.storage import get_storage
from app.services.tweet_ingest.urls import x_status_posted_at
from tests._fixtures import TINY_JPEG, gif_bytes, stored_bytes, stored_keys, stored_path
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


def test_an_event_holds_several_sources_in_the_posted_order(author, conflict):
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
        ("context", "https://ctx.example/article"),
        ("direct", "https://x.com/a/status/2"),
        ("indirect", "https://sat.example/after"),
        ("direct", "https://t.me/c/1"),
    ]
    assert read[3]["kind"] == "drone"
    assert read[3]["capture_position"] == {"lat": 48.4, "lng": 34.4}
    assert read[1]["title"] == "Second angle"
    assert read[0]["media"] is None and read[0]["kind"] == "article"
    assert all(s["media"] is not None for s in read[1:])
    # The first source with a file gives the card thumbnail.
    assert response.json()["thumbnail"]["id"] == read[1]["media"]["id"]


def test_an_edit_that_moves_the_sources_saves_their_new_order(author):
    created = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Where?",
            "sources": sources_field(
                source_spec("https://a.example", upload_id=stage_file(author)),
                source_spec("https://b.example", level="context"),
                source_spec("https://c.example", level="context"),
            ),
        },
    )
    a, b, c = created.json()["sources"]

    def kept(source: dict) -> dict:
        media = source["media"]["id"] if source["media"] else None
        return source_spec(
            source["links"][0]["url"], id=source["id"], level=source["level"], media_id=media
        )

    edited = client.post(
        f"/api/v1/events/{created.json()['id']}/request",
        headers=login_as(client, author),
        data={"title": "Where?", "sources": sources_field(kept(c), kept(a), kept(b))},
    )
    assert edited.status_code == 200, edited.text
    assert [s["id"] for s in edited.json()["sources"]] == [c["id"], a["id"], b["id"]]
    read = client.get(f"/api/v1/events/{created.json()['id']}")
    assert [s["id"] for s in read.json()["sources"]] == [c["id"], a["id"], b["id"]]


def test_a_document_source_drops_its_capture_position(author, conflict):
    sources = sources_field(
        source_spec(upload_id=stage_file(author)),
        source_spec(
            "https://news.example/report",
            level="context",
            kind="article",
            capture_position={"lat": 48.4, "lng": 34.4},
        ),
    )
    response = _create(author, conflict, sources)
    assert response.status_code == 201, response.text
    article = next(s for s in response.json()["sources"] if s["kind"] == "article")
    assert article["capture_position"] is None


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
    [body] = staged.json()["items"]
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
    assert response.json()["detail"] == {
        "code": "invalid_file",
        "message": "Images and videos only.",
    }


def test_an_upload_refuses_an_oversized_file_in_megabytes(author, monkeypatch):
    monkeypatch.setattr(settings, "max_video_size", 2**20)
    response = client.post(
        "/api/v1/uploads",
        headers=login_as(client, author),
        files={"file": ("big.mp4", b"\x00" * (2**20 + 1), "video/mp4")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "invalid_file",
        "message": "1 MB at most for a video.",
    }


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


def _post_gif(user, frames: int, filename: str = "comparison.gif"):
    return client.post(
        "/api/v1/uploads",
        headers=login_as(client, user),
        files={"file": (filename, gif_bytes(frames), "image/gif")},
    )


def test_a_gif_is_staged_as_one_png_per_frame(db, author, conflict):
    response = _post_gif(author, 2)
    assert response.status_code == 201, response.text
    items = response.json()["items"]
    assert [i["original_filename"] for i in items] == ["comparison-1.png", "comparison-2.png"]
    assert {i["kind"] for i in items} == {"image"}
    for index, item in enumerate(items):
        key = _key(item["storage_url"])
        assert key.endswith(".png")
        frame = Image.open(BytesIO(stored_bytes(key)))
        assert frame.format == "PNG"
        assert frame.convert("RGB").getpixel((0, 0)) == (40 * index, 0, 0)

    # Each frame is a file of its own: two sources take one each.
    specs = [source_spec(upload_id=item["id"]) for item in items]
    created = _create(author, conflict, sources_field(*specs))
    assert created.status_code == 201, created.text
    assert {s["media"]["storage_url"] for s in created.json()["sources"]} == {
        item["storage_url"] for item in items
    }


def test_a_single_frame_gif_is_staged_as_one_png(author):
    response = _post_gif(author, 1, filename="scan.gif")
    assert response.status_code == 201, response.text
    [item] = response.json()["items"]
    assert item["original_filename"] == "scan.png"
    assert _key(item["storage_url"]).endswith(".png")


def test_a_gif_past_the_frame_cap_is_refused_for_a_video(db, author):
    before = db.query(Upload).count()
    response = _post_gif(author, 7)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "evidence_processing_failed"
    assert "7 frames" in detail["message"] and "MP4" in detail["message"]
    assert db.query(Upload).count() == before
    assert not any(key.startswith("uploads/") for key in stored_keys())


def test_each_gif_frame_counts_toward_the_staged_file_cap(db, author, monkeypatch):
    monkeypatch.setattr(uploads_service, "MAX_PENDING_UPLOADS_PER_USER", 2)
    stage_file(author)
    response = _post_gif(author, 2)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "too_many_uploads"


# ── A file named by id ───────────────────────────────────────────────────────


def test_another_events_file_cannot_be_named(author, second_user, conflict):
    first = _create(author, conflict, filed_source(author))
    media_id = first.json()["sources"][0]["media"]["id"]
    response = _create(second_user, conflict, sources_field(source_spec(media_id=media_id)))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_media_not_found"


def test_a_source_may_take_a_sibling_sources_file(author, conflict):
    """A source naming the file of another source of the event takes it with its graphic
    flag, on the same stored object."""
    created = _create(
        author,
        conflict,
        sources_field(
            source_spec("https://example.com/a", upload_id=stage_file(author), is_graphic=True),
            source_spec("https://example.com/b", level="context"),
        ),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    filed = next(s for s in body["sources"] if s["media"] is not None)
    bare = next(s for s in body["sources"] if s["media"] is None)
    response = client.post(
        f"/api/v1/events/{body['id']}/versions",
        headers=login_as(client, author),
        data={
            "title": "Strike",
            "lat": "48.5",
            "lng": "34.5",
            "occurred_date": "2026-05-01",
            "proof": body["proof"],
            "conflict_ids": f'["{conflict.id}"]',
            "sources": sources_field(
                source_spec(
                    links=[{"url": "https://example.com/a"}, {"url": "https://example.com/b"}],
                    id=bare["id"],
                    media_id=filed["media"]["id"],
                )
            ),
        },
    )
    assert response.status_code == 200, response.text
    [merged] = response.json()["sources"]
    assert merged["id"] == bare["id"]
    assert merged["media"]["storage_url"] == filed["media"]["storage_url"]
    assert merged["is_graphic"] is True
    assert stored_path(_key(filed["media"]["storage_url"])).exists()


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


def test_an_x_link_without_a_post_time_takes_the_one_its_status_id_carries(author, conflict):
    """The write fills the post time of an X status link left blank; a typed time and a link
    that names no X status keep what was posted."""
    x_url = "https://x.com/analyst/status/1790000000000000000"
    typed_url = "https://x.com/analyst/status/1790000000000000001"
    links = [
        {"url": x_url, "posted_at": None},
        {"url": typed_url, "posted_at": "2026-05-01T12:00"},
        {"url": "https://t.me/channel/12345", "posted_at": None},
    ]
    sources = sources_field(source_spec(links=links, upload_id=stage_file(author)))
    response = _create(author, conflict, sources)
    assert response.status_code == 201, response.text
    posted = {link["url"]: link["posted_at"] for link in response.json()["sources"][0]["links"]}
    expected = x_status_posted_at(x_url)
    assert expected is not None
    assert datetime.fromisoformat(posted[x_url]) == expected
    assert datetime.fromisoformat(posted[typed_url]) == datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    assert posted["https://t.me/channel/12345"] is None


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


# ── Filters and search ───────────────────────────────────────────────────────


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
        response = client.get("/api/v1/search", params={"q": q, "type": "event"})
        assert response.status_code == 200
        assert str(geo.id) in {hit["id"] for hit in response.json()["hits"]}, q


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


# ── Imagery warnings ─────────────────────────────────────────────────────────


MAPS_LINK = "https://www.google.com/maps/@47.09,37.54,500m/data=!3m1!1e3"


def test_an_imagery_source_carries_warnings_and_still_publishes(author, conflict):
    sources = sources_field(
        source_spec(upload_id=stage_file(author)),
        source_spec(MAPS_LINK, level="context", kind="satellite"),
        source_spec("https://aerial.example/frame/1", level="context", kind="aircraft"),
    )
    response = _create(author, conflict, sources)
    assert response.status_code == 201, response.text
    footage, satellite, aircraft = response.json()["sources"]
    assert footage["warnings"] == []
    assert [(w["code"], w["url"]) for w in satellite["warnings"]] == [
        ("provider_not_reopenable", MAPS_LINK),
        ("capture_date_missing", None),
    ]
    assert aircraft["kind"] == "aircraft"
    assert [w["code"] for w in aircraft["warnings"]] == ["provider_unknown", "capture_date_missing"]
    read = client.get(f"/api/v1/events/{response.json()['id']}").json()
    assert read["sources"][1]["warnings"] == satellite["warnings"]


def test_the_check_names_each_links_provider_and_the_warnings(author):
    earth = "https://earth.google.com/web/@47.09,37.54,50a,2000d,35y,0h,0t,0r"
    response = client.post(
        "/api/v1/sources/check",
        headers=login_as(client, author),
        json={
            "kind": "satellite",
            "captured_at": "2024-07-12T10:00",
            "links": [{"url": earth}, {"url": "https://news.example/a", "snapshot_url": None}],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    first, second = body["links"]
    assert first["provider"]["id"] == "google_earth"
    assert first["provider"]["credit"] and first["provider"]["help"]
    assert second == {"url": "https://news.example/a", "provider": None}
    assert [(w["code"], w["url"]) for w in body["warnings"]] == [("permalink_shape", earth)]


def test_the_check_needs_an_account_and_an_imagery_kind(author):
    assert client.post("/api/v1/sources/check", json={"kind": "satellite"}).status_code == 401
    response = client.post(
        "/api/v1/sources/check", headers=login_as(client, author), json={"kind": "drone"}
    )
    assert response.status_code == 422
