"""End-to-end tests for the requested view.

A request is an ``Event`` with ``status='requested'``; a withdrawn one stays visible
as ``closed`` with ``before_closed_status='requested'``. ``POST
/events/{id}/versions`` fulfils it in place: ownership moves to the fulfiller and
``requested_by`` keeps the poster. Local storage backend so uploads exercise the real
path.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.models.event import (
    STATUS_CLOSED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventVersion,
)
from app.models.media import Media
from app.models.source import Source, SourceLink
from app.models.tag import Tag
from app.models.user import User
from app.schemas.source import SourceCreate
from app.services.events import (
    EventStateError,
    ImportProvenance,
    stamp_provenance,
    update_request,
)
from app.services.sanitize import extract_image_srcs
from tests._fixtures import fake_sha256
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

_LIST = "/api/v1/events?view=requested"
_POST_URL = "https://example.com/post"


def _make_request(
    db,
    *,
    author: User,
    title: str | None = None,
    source_url: str = _POST_URL,
    status: str = STATUS_REQUESTED,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    with_media: bool = True,
) -> Event:
    """Mirrors the create path, stamps included (the CHECKs demand them). The one direct
    source is of kind ``unknown``."""
    now = datetime.now(UTC)
    request = Event(
        owner_id=author.id,
        requested_by_id=author.id,
        title=title or f"Request {uuid.uuid4().hex[:8]}",
        status=status,
        requested_at=now,
        closed_at=now if status == STATUS_CLOSED else None,
        before_closed_status=STATUS_REQUESTED if status == STATUS_CLOSED else None,
        close_reason="Withdrawn" if status == STATUS_CLOSED else None,
    )
    request.sources = [
        Source(
            level="direct",
            kind="unknown",
            links=[SourceLink(url=source_url, posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC))],
            media=(
                Media(
                    sha256=fake_sha256(),
                    storage_url=(
                        f"http://localhost:8000/local-storage/request_uploads/{uuid.uuid4()}/x.jpg"
                    ),
                    kind="image",
                )
                if with_media
                else None
            ),
        )
    ]
    if deleted:
        request.deleted_at = datetime.now(UTC)
    if tags:
        request.tags = tags
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def _kept(event: Event, *, kind: str | None = "smartphone", **kw) -> str:
    """The ``sources`` field re-posting every stored source of ``event`` by ``id`` with its
    own file."""
    return sources_field(
        *(
            source_spec(
                source.links[0].url,
                id=str(source.id),
                media_id=str(source.media.id) if source.media is not None else None,
                kind=kind,
                **kw,
            )
            for source in event.sources
        )
    )


def _create_request(user: User, *, files=None, **data):
    """``POST /events/requests`` as ``user``, with one filed direct source unless ``sources``
    is given."""
    if "sources" not in data:
        data["sources"] = filed_source(user, url="https://example.com/post/1", kind="unknown")
    return client.post(
        "/api/v1/events/requests", headers=login_as(client, user), data=data, files=files
    )


def test_list_returns_seeded_request(db, author):
    request = _make_request(db, author=author)
    response = client.get(_LIST)
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(request.id) in ids


def test_list_excludes_soft_deleted(db, author):
    live = _make_request(db, author=author)
    dead = _make_request(db, author=author, deleted=True)
    response = client.get(_LIST)
    ids = {row["id"] for row in response.json()}
    assert str(live.id) in ids
    assert str(dead.id) not in ids


def test_list_filters_by_status(db, author):
    open_one = _make_request(db, author=author, status=STATUS_REQUESTED)
    closed = _make_request(db, author=author, status=STATUS_CLOSED)

    response = client.get(f"{_LIST}&status={STATUS_REQUESTED}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(open_one.id) in ids
    assert str(closed.id) not in ids


def test_list_includes_withdrawn_but_not_rejected_closed(db, author):
    """``before_closed_status`` splits a withdrawn request from a rejected detection."""
    withdrawn = _make_request(db, author=author, status=STATUS_CLOSED)
    rejected = _make_geo(db, author=author, status=STATUS_CLOSED)
    rejected.before_closed_status = "detected"
    db.commit()

    ids = {row["id"] for row in client.get(_LIST).json()}
    assert str(withdrawn.id) in ids
    assert str(rejected.id) not in ids


def test_list_excludes_located_events(db, author):
    """A fulfilled request never surfaces in the requested view."""
    requested = _make_request(db, author=author)
    located = _make_geo(db, author=author, status=STATUS_GEOLOCATED)

    ids = {row["id"] for row in client.get(_LIST).json()}
    assert str(requested.id) in ids
    assert str(located.id) not in ids


def test_list_rejects_unknown_view(author):
    assert client.get("/api/v1/events?view=bogus").status_code == 422


def test_list_filters_by_tag(db, author, free_tag):
    with_tag = _make_request(db, author=author, tags=[free_tag])
    without_tag = _make_request(db, author=author)

    response = client.get(f"{_LIST}&tag={free_tag.name}")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(with_tag.id) in ids
    assert str(without_tag.id) not in ids


def test_list_filters_by_author_exact(db, author):
    """Exact case-insensitive match; a fragment matches nothing."""
    request = _make_request(db, author=author)
    response = client.get(f"{_LIST}&author={author.username.upper()}")
    assert response.status_code == 200
    assert str(request.id) in {row["id"] for row in response.json()}
    response = client.get(f"{_LIST}&author={author.username[2:6]}")
    assert response.status_code == 200
    assert str(request.id) not in {row["id"] for row in response.json()}


def test_list_honours_limit(db, author):
    for _ in range(3):
        _make_request(db, author=author)
    response = client.get(f"{_LIST}&limit=2")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_rejects_unusable_limit(author):
    """Below 1 and non-numeric are 422; over the cap clamps."""
    for bad in ("0", "-1", "abc"):
        response = client.get(f"{_LIST}&limit={bad}")
        assert response.status_code == 422, f"expected 422 for limit={bad!r}"


def test_detail_returns_full_shape(db, author, free_tag):
    request = _make_request(db, author=author, tags=[free_tag])
    response = client.get(f"/api/v1/events/{request.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(request.id)
    assert body["title"] == request.title
    assert body["status"] == STATUS_REQUESTED
    assert body["coords"] is None
    assert body["owner"]["username"] == author.username
    assert any(tag["name"] == free_tag.name for tag in body["tags"])
    [source] = body["sources"]
    assert [link["url"] for link in source["links"]] == [_POST_URL]
    assert source["media"]["id"] == str(request.sources[0].media.id)
    assert body["geolocators"] == []


def test_detail_404_for_soft_deleted(db, author):
    request = _make_request(db, author=author, deleted=True)
    response = client.get(f"/api/v1/events/{request.id}")
    assert response.status_code == 404


def test_create_requires_authentication():
    response = client.post("/api/v1/events/requests")
    assert response.status_code == 401


def test_create_requires_the_sources_field(author):
    response = client.post(
        "/api/v1/events/requests", headers=login_as(client, author), data={"title": "x"}
    )
    assert response.status_code == 422


def test_create_rejects_blank_title(author):
    response = _create_request(author, title="   ")
    assert response.status_code == 400
    assert "title" in response.json()["detail"].lower()


def test_create_rejects_blank_source_url(author):
    sources = sources_field(source_spec("  ", upload_id=stage_file(author)))
    response = _create_request(author, title="ok", sources=sources)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_link_required"


def test_create_rejects_over_length_title(author):
    """A title past 255 chars 422s at the Form boundary, before any upload."""
    response = _create_request(author, title="a" * 256)
    assert response.status_code == 422


def test_create_rejects_over_length_source_url(author):
    sources = sources_field(source_spec("https://example.com/" + "a" * 2000))
    response = _create_request(author, title="ok", sources=sources)
    assert response.status_code == 422


def test_create_rejects_unsanitisable_proof(author):
    """A proof past the sanitiser's tag-count cap gets ``invalid_proof`` before any upload."""
    response = _create_request(author, title="ok", proof="<br>" * 10_001)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_proof"


def test_create_rejects_half_typed_coordinate_guess(author):
    response = _create_request(author, title="ok", lat="48.5")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_create_happy_path(db, author, free_tag):
    response = _create_request(author, title="Footage from a strike", tag_ids=f'["{free_tag.id}"]')
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_REQUESTED
    assert body["coords"] is None
    assert body["owner"]["username"] == author.username
    assert body["requested_by"]["username"] == author.username
    assert any(t["name"] == free_tag.name for t in body["tags"])
    [source] = body["sources"]
    assert source["level"] == "direct" and source["media"] is not None

    # The created row is a requested event with no location and the poster on
    # ``requested_by_id``, the invariant fulfilment relies on.
    row = db.query(Event).filter(Event.id == uuid.UUID(body["id"])).one()
    assert row.status == STATUS_REQUESTED
    assert row.coords is None
    assert row.requested_by_id == author.id


def test_create_accepts_coordinate_guess(author):
    """The guess round-trips without promoting the row out of ``requested``."""
    response = _create_request(author, title="Roughly here", lat="48.5", lng="34.5")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_REQUESTED
    assert body["coords"] == {"lat": 48.5, "lng": 34.5}


def test_create_occurred_date_is_optional(author):
    """``occurred_date`` is optional; the link keeps its own post time either way."""
    sources = filed_source(author, kind="unknown", posted_at="2026-05-02T09:30")
    with_dates = _create_request(
        author, title="Dated request", occurred_date="2026-05-01", sources=sources
    )
    assert with_dates.status_code == 201, with_dates.text
    assert with_dates.json()["occurred_date"] == "2026-05-01"
    link = with_dates.json()["sources"][0]["links"][0]
    assert link["posted_at"].startswith("2026-05-02T09:30")

    without = _create_request(author, title="Undated request")
    assert without.status_code == 201, without.text
    assert without.json()["occurred_date"] is None


def test_create_request_keeps_proof_image(db, author):
    """A request may carry proof images; there is no proof-image floor."""
    response = _create_request(
        author,
        title="Request with a proof image",
        proof=proof_form_field(),
        files=[proof_file_part()],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "requested"
    srcs = extract_image_srcs(body["proof"])
    assert len(srcs) == 1
    assert srcs[0].startswith("http")  # placeholder rewritten to the landed URL
    assert "placeholder://" not in body["proof"]

    proof_rows = db.query(Media).filter(Media.event_id == uuid.UUID(body["id"])).all()
    assert [m.storage_url for m in proof_rows] == srcs
    assert body["sources"][0]["media"] is not None


def test_create_request_event_time_without_occurred_date(author):
    """An hour-of-day is knowable before the day is."""
    response = _create_request(author, title="Timed but undated", occurred_time="14:30")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["occurred_date"] is None
    assert body["occurred_time"].startswith("14:30")


def test_create_request_blank_proof_stores_an_empty_body(db, author):
    """The model default must fire: ``events.proof`` is NOT NULL and ``create_request``
    omits ``proof=``."""
    response = _create_request(author, title="No proof yet")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["proof"] == ""
    assert db.query(Media).filter(Media.event_id == uuid.UUID(body["id"])).count() == 0


def test_create_request_drops_unsafe_proof_image_src(author):
    """The sanitiser still drops an unsafe src (protocol-relative URL) on a request."""
    unsafe_doc = '<img src="//evil.example/pixel.gif"><p>wip</p>'
    response = _create_request(author, title="Unsafe proof image", proof=unsafe_doc)
    assert response.status_code == 201, response.text
    assert response.json()["proof"] == "<p>wip</p>"


def test_create_rejects_invalid_occurred_date(author):
    response = _create_request(author, title="x", occurred_date="not-a-date")
    assert response.status_code == 422
    assert "occurred_date" in response.json()["detail"].lower()


def test_create_populates_sha256_on_media(db, author):
    """The API hash equals the row hash, so an auditor can recompute it from the bytes."""
    # The EXIF strip re-encodes, so the post-strip hash is not known ahead; assert API
    # hash == row hash.
    response = _create_request(author, title="hash test")
    assert response.status_code == 201, response.text
    media = response.json()["sources"][0]["media"]
    assert isinstance(media["sha256"], str)
    assert len(media["sha256"]) == 64
    row = db.query(Media).filter(Media.id == uuid.UUID(media["id"])).one()
    assert row.sha256 == media["sha256"]
    assert row.source_id is not None and row.event_id is None


def test_close_owner_only(db, author, second_user):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, second_user),
        json={"close_reason": "not mine to close"},
    )
    assert response.status_code == 403


def test_close_requires_reason(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={},
    )
    assert response.status_code == 422


def test_close_transitions_to_closed(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "Footage turned out to be from 2014"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["closed_at"] is not None
    assert body["before_closed_status"] == STATUS_REQUESTED
    assert body["close_reason"] == "Footage turned out to be from 2014"


def test_close_rejected_on_terminal_state(db, author):
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = client.post(
        f"/api/v1/events/{request.id}/close",
        headers=login_as(client, author),
        json={"close_reason": "again"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def _geolocate_fulfilment(request_id, fulfiller, conflict, sources: str, **overrides):
    """POST the geolocate form that fulfils a requested event; only the proof image is
    new."""
    data = {
        "title": "Fulfilled from a request",
        "lat": "48.5",
        "lng": "34.5",
        "occurred_date": "2026-05-01",
        "conflict_ids": json.dumps([str(conflict.id)]),
        "proof": proof_form_field(),
        "sources": sources,
    }
    data.update(overrides)
    return client.post(
        f"/api/v1/events/{request_id}/versions",
        headers=login_as(client, fulfiller),
        data=data,
        files=[proof_file_part()],
    )


def test_geolocate_fulfils_requested_and_transfers_ownership(db, author, second_user, conflict):
    """The poster stays on ``requested_by``; ``owner_id`` moves to the fulfiller."""
    request = _make_request(db, author=author)
    request_id = request.id

    response = _geolocate_fulfilment(request_id, second_user, conflict, _kept(request))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(request_id)
    assert body["status"] == "geolocated"
    assert body["coords"] == {"lat": 48.5, "lng": 34.5}
    assert body["owner"]["username"] == second_user.username
    assert body["requested_by"]["username"] == author.username
    assert [g["username"] for g in body["geolocators"]] == [second_user.username]

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_GEOLOCATED
    assert row.owner_id == second_user.id
    assert row.requested_by_id == author.id
    assert row.coords is not None
    credit = db.query(EventGeolocator).filter(EventGeolocator.event_id == request_id).all()
    assert [c.user_id for c in credit] == [second_user.id]


def test_a_fulfiller_may_replace_the_requesters_sources(db, author, second_user, conflict):
    """The requester's sources are not locked at geolocate: the fulfiller's list replaces
    them like any other field."""
    request = _make_request(db, author=author, source_url="https://requester.example/evidence")
    requester_source_id = request.sources[0].id

    sources = filed_source(second_user, url="https://fulfiller.example/better")
    response = _geolocate_fulfilment(request.id, second_user, conflict, sources)
    assert response.status_code == 200, response.text
    [source] = response.json()["sources"]
    assert [link["url"] for link in source["links"]] == ["https://fulfiller.example/better"]
    assert source["id"] != str(requester_source_id)

    db.expire_all()
    assert db.get(Source, requester_source_id) is None


def test_geolocate_fulfilled_event_leaves_requested_view(db, author, second_user, conflict):
    request = _make_request(db, author=author)
    request_id = request.id

    response = _geolocate_fulfilment(request_id, second_user, conflict, _kept(request))
    assert response.status_code == 200, response.text

    assert all(row["id"] != str(request_id) for row in client.get(_LIST).json())
    located = client.get(f"/api/v1/events/{request_id}")
    assert located.status_code == 200
    assert located.json()["status"] == "geolocated"
    listed = {row["id"] for row in client.get("/api/v1/events").json()}
    assert str(request_id) in listed


def test_geolocate_fulfilment_reuses_existing_media(db, author, second_user, conflict):
    """A source kept by ``id`` keeps its file row; the proof lands beside it."""
    request = _make_request(db, author=author)
    request_id = request.id
    media_id = request.sources[0].media.id

    response = _geolocate_fulfilment(request_id, second_user, conflict, _kept(request))
    assert response.status_code == 200, response.text
    assert response.json()["sources"][0]["media"]["id"] == str(media_id)

    db.expire_all()
    assert db.get(Media, media_id) is not None
    assert db.query(Media).filter(Media.event_id == request_id).count() == 1


def test_fulfilment_publishes_a_source_of_unknown_kind(db, author, second_user, conflict):
    """``unknown`` is a kind like any other: the publication takes it."""
    request = _make_request(db, author=author)
    response = _geolocate_fulfilment(
        request.id, second_user, conflict, _kept(request, kind="unknown")
    )
    assert response.status_code == 200, response.text
    assert response.json()["sources"][0]["kind"] == "unknown"


def test_geolocate_fulfilment_honors_analyst_title_and_tags(
    db, author, second_user, free_tag, conflict
):
    """The fulfiller may refine title and tags; the conflict floor still holds."""
    request = _make_request(db, author=author, title="Original request title", tags=[free_tag])

    response = _geolocate_fulfilment(
        request.id,
        second_user,
        conflict,
        _kept(request),
        title="Refined title with place name",
        tag_ids=json.dumps([str(free_tag.id)]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Refined title with place name"
    assert {t["name"] for t in body["tags"]} == {free_tag.name}
    assert conflict.name in {c["name"] for c in body["conflicts"]}


def test_geolocate_fulfilment_blocked_without_a_conflict(db, author, second_user, conflict):
    """The floor applies to fulfilment although the request itself may name no conflict."""
    request = _make_request(db, author=author)
    response = _geolocate_fulfilment(
        request.id, second_user, conflict, _kept(request), conflict_ids=json.dumps([])
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "conflict_required"


def test_geolocate_fulfilment_rejected_when_closed(db, author, second_user, conflict):
    """A withdrawn request is terminal: geolocate 409s with ``invalid_state``."""
    request = _make_request(db, author=author, status=STATUS_CLOSED)
    response = _geolocate_fulfilment(request.id, second_user, conflict, _kept(request))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_geolocate_fulfilment_404_for_unknown(author, conflict):
    response = _geolocate_fulfilment(uuid.uuid4(), author, conflict, sources_field(source_spec()))
    assert response.status_code == 404


def _edit_request(request: Event, editor: User, **overrides):
    """Defaults move every field the create form writes and keep the stored sources; override
    one per test."""
    data = {
        "title": "Edited title",
        "occurred_date": "2026-05-02",
        "sources": _kept(request, kind="unknown"),
    }
    data.update(overrides)
    return client.post(
        f"/api/v1/events/{request.id}/request",
        headers=login_as(client, editor),
        data=data,
    )


def test_edit_request_overwrites_in_place_without_a_version(db, author, free_tag):
    """The edit files no ``event_versions`` row; the version stays 1."""
    request = _make_request(db, author=author, source_url="https://example.com/first")
    request_id = request.id
    [stored] = request.sources

    links = [
        {"url": "https://example.com/second", "posted_at": "2026-05-01T12:00"},
        {"url": "https://mirror.example/a", "posted_at": "2026-05-01T13:00"},
    ]
    response = _edit_request(
        request,
        author,
        sources=sources_field(
            source_spec(None, id=str(stored.id), media_id=str(stored.media.id), links=links)
        ),
        tag_ids=json.dumps([str(free_tag.id)]),
        proof="<p></p>",
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(request_id)
    assert body["status"] == STATUS_REQUESTED
    assert body["title"] == "Edited title"
    assert body["occurred_date"] == "2026-05-02"
    assert [link["url"] for link in body["sources"][0]["links"]] == [
        "https://example.com/second",
        "https://mirror.example/a",
    ]
    assert [t["name"] for t in body["tags"]] == [free_tag.name]
    # The request stays version 0 and files no version until it is published.
    assert body["version_no"] == 0
    # The poster keeps both roles: an edit is not a change of hands.
    assert body["owner"]["username"] == author.username
    assert body["requested_by"]["username"] == author.username

    db.expire_all()
    row = db.query(Event).filter(Event.id == request_id).one()
    assert row.status == STATUS_REQUESTED
    assert row.title == "Edited title"
    assert {link.url for link in row.sources[0].links} == {
        "https://example.com/second",
        "https://mirror.example/a",
    }
    assert row.version_no == 0
    assert db.query(EventVersion).filter(EventVersion.event_id == request_id).count() == 0


def test_edit_request_moves_the_coordinate_guess(db, author):
    """An edit posting neither half clears the guess."""
    request = _make_request(db, author=author)
    request_id = request.id

    placed = _edit_request(request, author, lat="48.5", lng="34.5")
    assert placed.status_code == 200, placed.text
    assert placed.json()["coords"] == {"lat": 48.5, "lng": 34.5}

    cleared = _edit_request(request, author)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["coords"] is None

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().coords is None


def test_edit_request_accepts_the_stored_instant_verbatim(db, author):
    """The form posts the link's value back, so the write must accept a full UTC instant
    (seconds and zone), not minute precision."""
    request = _make_request(db, author=author)
    [stored] = request.sources
    sources = sources_field(
        source_spec(
            _POST_URL,
            id=str(stored.id),
            media_id=str(stored.media.id),
            kind="unknown",
            posted_at="2026-05-01T12:00:27Z",
        )
    )
    response = _edit_request(request, author, sources=sources)
    assert response.status_code == 200, response.text
    assert response.json()["sources"][0]["links"][0]["posted_at"] == "2026-05-01T12:00:27Z"


def test_edit_request_clears_the_occurred_date(db, author):
    """``occurred_date`` is the one optional field an edit clears."""
    request = _make_request(db, author=author)
    request_id = request.id
    dated = _edit_request(request, author, occurred_date="2026-05-02")
    assert dated.status_code == 200, dated.text
    assert dated.json()["occurred_date"] == "2026-05-02"

    cleared = _edit_request(request, author, occurred_date="")
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["occurred_date"] is None

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).one().occurred_date is None


def test_edit_request_cannot_unset_the_graphic_flag(db, author):
    """A source's ``is_graphic`` only ratchets up, as on ``geolocate`` and ``save_version``;
    only ``PATCH /admin/events/{id}/moderation`` clears it."""
    request = _make_request(db, author=author)
    request.sources[0].is_graphic = True
    db.commit()

    response = _edit_request(
        request, author, sources=_kept(request, kind="unknown", is_graphic=False)
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True
    assert response.json()["sources"][0]["is_graphic"] is True

    db.expire_all()
    assert db.get(Event, request.id).sources[0].is_graphic is True


def test_edit_request_keeps_the_requested_at_stamp(db, author):
    """The edit keeps ``requested_at``, the requests board ordering key."""
    request = _make_request(db, author=author)
    request_id = request.id
    opened_at = request.requested_at

    response = _edit_request(request, author)
    assert response.status_code == 200, response.text

    db.expire_all()
    edited = db.query(Event).filter(Event.id == request_id).one()
    assert edited.requested_at == opened_at
    assert edited.title == "Edited title"


async def test_edit_request_loses_the_race_to_a_fulfilment(db, author):
    """A publish committing between the router's row resolution and the service's
    locked re-read makes the edit refuse (409) on the post-lock status. Service-level:
    the stale row goes straight to ``update_request`` while a second session holds the
    committed fulfilment. The owner answers their own request so the refusal turns on
    status alone (anyone else is refused earlier by ``ensure_owner``)."""
    request = _make_request(db, author=author)
    request_id = request.id

    # The competing fulfilment commits from its own session; this session's row is now
    # stale.
    winner = SessionLocal()
    try:
        fulfilled = winner.query(Event).filter(Event.id == request_id).one()
        fulfilled.status = STATUS_GEOLOCATED
        fulfilled.version_no = 1
        fulfilled.coords = from_shape(Point(37.8, 48.5), srid=4326)
        fulfilled.geolocated_at = datetime.now(UTC)
        winner.commit()
    finally:
        winner.close()

    with pytest.raises(EventStateError):
        await update_request(
            db,
            geo=request,
            current_user=author,
            title="Raced edit",
            proof_data=None,
            tag_ids=[],
            conflict_ids=[],
            sources=[
                SourceCreate.model_validate(
                    source_spec("https://example.com/raced", kind="unknown")
                )
            ],
            proof_files=[],
        )

    db.rollback()
    db.expire_all()
    raced = db.query(Event).filter(Event.id == request_id).one()
    assert raced.status == STATUS_GEOLOCATED
    assert raced.title != "Raced edit"
    assert [link.url for link in raced.sources[0].links] == [_POST_URL]


def test_edit_request_refuses_to_leave_the_row_without_footage(db, author):
    """Dropping the footage without a replacement is refused (the source floor)."""
    request = _make_request(db, author=author)
    [stored] = request.sources

    response = _edit_request(
        request, author, sources=sources_field(source_spec(id=str(stored.id), kind="unknown"))
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_file_required"

    db.expire_all()
    assert db.get(Source, stored.id).media is not None


def test_edit_request_owner_only(db, author, second_user):
    """Anyone can fulfil an open request; only its owner can edit it."""
    request = _make_request(db, author=author)
    response = _edit_request(request, second_user)
    assert response.status_code == 403


def test_edit_request_requires_authentication(db, author):
    request = _make_request(db, author=author)
    response = client.post(
        f"/api/v1/events/{request.id}/request",
        data={"title": "Edited title", "sources": _kept(request, kind="unknown")},
    )
    assert response.status_code == 401


def test_edit_request_rejects_a_row_that_left_requested(db, author):
    """Only an open request takes this write."""
    for status in (STATUS_GEOLOCATED, "detected", STATUS_CLOSED):
        geo = _make_geo(db, author=author, status=status, with_media=True)
        response = _edit_request(geo, author)
        assert response.status_code == 409, f"{status}: {response.text}"
        assert response.json()["detail"]["code"] == "invalid_state"


def test_edit_request_404_for_unknown(author):
    response = client.post(
        f"/api/v1/events/{uuid.uuid4()}/request",
        headers=login_as(client, author),
        data={"title": "Edited title", "sources": sources_field(source_spec())},
    )
    assert response.status_code == 404


def test_edit_request_rejects_blank_title(db, author):
    request = _make_request(db, author=author)
    response = _edit_request(request, author, title="   ")
    assert response.status_code == 400
    assert response.json()["detail"] == "title is required"


def test_edit_request_keeps_the_provenance_of_a_bot_opened_row(db, author):
    """The edit leaves the five import columns where the import stamped them."""
    request = _make_request(db, author=author)
    request_id = request.id
    provenance = ImportProvenance(
        tweet_id=1234567890,
        url="https://x.com/analyst/status/1234567890",
        thread_tweet_ids=[1234567890],
        via="bot",
        post_at=datetime(2026, 5, 1, 8, 0, tzinfo=UTC),
    )
    row = db.query(Event).filter(Event.id == request_id).one()
    stamp_provenance(row, provenance)
    db.commit()

    response = _edit_request(request, author)
    assert response.status_code == 200, response.text
    assert response.json()["detected_from_url"] == provenance.url
    assert response.json()["detected_via"] == "bot"

    db.expire_all()
    edited = db.query(Event).filter(Event.id == request_id).one()
    assert edited.title == "Edited title"
    assert edited.detection.from_post_id == provenance.tweet_id
    assert edited.detection.from_url == provenance.url
    assert edited.detection.thread_post_ids == provenance.thread_tweet_ids
    assert edited.detection.via == "bot"
    assert edited.detection.post_at == provenance.post_at
