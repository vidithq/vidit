"""Secondary source links: the ordered mirrors beside the primary ``source_url``.

The repeated ``secondary_source_urls`` multipart field on the three write paths
(create, request, geolocate), the normalization every one of them shares (blanks
and duplicates stripped, the primary dropped, the cap enforced as a 400), the
ordered read, the geolocate replacement, the hard-delete cascade, and the
duplicate probe's leg over the child table. Shared fixtures live in
`conftest.py`; `client` / `_make_geo` / the proof helpers in `_helpers.py`.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.event import (
    MAX_SECONDARY_SOURCE_LINKS,
    SOURCE_URL_MAX_LENGTH,
    STATUS_DETECTED,
    STATUS_REQUESTED,
    Event,
    EventSourceLink,
)
from app.services.events import truncate_secondary_source_urls
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)

_PRIMARY = "https://x.com/a/status/1"
_MIRROR_A = "https://t.me/channel/11"
_MIRROR_B = "https://www.youtube.com/watch?v=MIRROR002"


def _create_form(**overrides):
    form = {
        "title": "x",
        "lat": "0.0",
        "lng": "0.0",
        "source_url": _PRIMARY,
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "proof": proof_form_field(),
    }
    form.update(overrides)
    return form


def _create_files():
    return [("file", ("tiny.jpg", TINY_JPEG, "image/jpeg")), proof_file_part()]


def _create(author, conflict, capture_source_tag, **overrides):
    """POST the direct-create form with the evidence floor met."""
    return client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data=_create_form(
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
            **overrides,
        ),
        files=_create_files(),
    )


# ── POST /events: the field lands, ordered ────────────────────────────────


def test_create_stores_and_returns_links_in_order(db, author, conflict, capture_source_tag):
    """The submitted order is the stored order and the read order: the child
    rows' ``position`` is the list index, and the relationship orders by it."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[_MIRROR_A, _MIRROR_B],
    )
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == [_MIRROR_A, _MIRROR_B]

    geo = db.query(Event).filter(Event.id == uuid.UUID(response.json()["id"])).one()
    assert [(link.position, link.url) for link in geo.source_links] == [
        (0, _MIRROR_A),
        (1, _MIRROR_B),
    ]


def test_create_without_links_serialises_an_empty_list(db, author, conflict, capture_source_tag):
    """Required-nullable-style: the key is always present, never omitted."""
    response = _create(author, conflict, capture_source_tag)
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == []


def test_detail_read_returns_the_links_in_order(db, author):
    geo = _make_geo(db, author=author, secondary_source_urls=[_MIRROR_A, _MIRROR_B])
    response = client.get(f"/api/v1/events/{geo.id}")
    assert response.status_code == 200
    assert response.json()["secondary_source_urls"] == [_MIRROR_A, _MIRROR_B]


# ── Normalization (one home, shared by all three write paths) ─────────────


def test_create_strips_blanks_and_duplicates(db, author, conflict, capture_source_tag):
    """Blank entries vanish and a repeat keeps only its first position, so a
    form that submitted empty rows doesn't store empty links."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=["", _MIRROR_A, "   ", _MIRROR_B, _MIRROR_A],
    )
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == [_MIRROR_A, _MIRROR_B]


def test_create_drops_an_entry_equal_to_the_primary(db, author, conflict, capture_source_tag):
    """The primary anchor is not one of its own mirrors."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[f"  {_PRIMARY}  ", _MIRROR_A],
    )
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == [_MIRROR_A]


def test_create_rejects_more_links_than_the_cap(author, conflict, capture_source_tag):
    """Past the cap the submission is refused, not silently truncated: an
    analyst who pasted eleven mirrors should be told which rule bit."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[
            f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS + 1)
        ],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_source_links"


def test_create_counts_the_cap_after_normalization(author, conflict, capture_source_tag):
    """Blanks and duplicates the client sent must not push a legitimate
    submission over the cap."""
    submitted = [f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS)]
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=[*submitted, "", submitted[0]],
    )
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == submitted


def test_create_rejects_an_over_length_link(author, conflict, capture_source_tag):
    """The ceiling rides on the ITEM, not the list: one over-long URL is
    rejected at the boundary, before the files reach storage."""
    response = _create(
        author,
        conflict,
        capture_source_tag,
        secondary_source_urls=["https://mirror.example/" + "x" * SOURCE_URL_MAX_LENGTH],
    )
    assert response.status_code == 422


# ── POST /events/requests ─────────────────────────────────────────────────


def test_request_stores_the_links(db, author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Help geolocate",
            "source_url": _PRIMARY,
            "source_posted_at": "2026-05-01T12:00",
            "secondary_source_urls": [_MIRROR_A, _MIRROR_B],
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 201
    assert response.json()["secondary_source_urls"] == [_MIRROR_A, _MIRROR_B]


def test_request_rejects_more_links_than_the_cap(author):
    response = client.post(
        "/api/v1/events/requests",
        headers=login_as(client, author),
        data={
            "title": "Help geolocate",
            "source_url": _PRIMARY,
            "source_posted_at": "2026-05-01T12:00",
            "secondary_source_urls": [
                f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS + 1)
            ],
        },
        files=[("file", ("tiny.jpg", TINY_JPEG, "image/jpeg"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_source_links"


# ── POST /events/{id}/geolocate: replacement, no requester protection ─────


def _geolocate_form(conflict, capture_source_tag, **overrides):
    form = {
        "title": "Edited title",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": _PRIMARY,
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
        "tag_ids": json.dumps([str(capture_source_tag.id)]),
        "conflict_ids": json.dumps([str(conflict.id)]),
        "proof": proof_form_field(),
    }
    form.update(overrides)
    return form


def test_geolocate_replaces_the_stored_links(db, author, conflict, capture_source_tag):
    """Wholesale replacement: the submitted list wins, positions are renumbered
    from zero, and the dropped rows are gone (the deletes flush before the
    replacement inserts, so a reused ``position`` can't collide on the PK)."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url=_PRIMARY,
        source_url=_PRIMARY,
        secondary_source_urls=[_MIRROR_A, _MIRROR_B],
        with_media=True,
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, author),
        data=_geolocate_form(
            conflict,
            capture_source_tag,
            secondary_source_urls=["https://mirror.example/only"],
        ),
        files=[proof_file_part()],
    )
    assert response.status_code == 200
    assert response.json()["secondary_source_urls"] == ["https://mirror.example/only"]

    db.expire_all()
    rows = db.query(EventSourceLink).filter(EventSourceLink.event_id == geo.id).all()
    assert [(row.position, row.url) for row in rows] == [(0, "https://mirror.example/only")]


def test_geolocate_clears_the_links_when_none_are_submitted(
    db, author, conflict, capture_source_tag
):
    """An empty field is a real value here (the mirrors were wrong), not a
    "leave them alone" signal."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url=_PRIMARY,
        source_url=_PRIMARY,
        secondary_source_urls=[_MIRROR_A],
        with_media=True,
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, author),
        data=_geolocate_form(conflict, capture_source_tag),
        files=[proof_file_part()],
    )
    assert response.status_code == 200
    assert response.json()["secondary_source_urls"] == []


def test_fulfiller_replaces_a_requesters_links(
    db, author, second_user, conflict, capture_source_tag
):
    """Unlike ``source_url`` (frozen as the requester's evidence anchor), the
    mirrors carry no requester protection: the fulfiller's list wins while the
    primary stays the requester's."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_REQUESTED,
        source_url=_PRIMARY,
        secondary_source_urls=[_MIRROR_A],
        with_media=True,
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, second_user),
        data=_geolocate_form(
            conflict,
            capture_source_tag,
            source_url="https://x.com/fulfiller/status/9",
            secondary_source_urls=[_MIRROR_B],
        ),
        files=[proof_file_part()],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_url"] == _PRIMARY
    assert body["secondary_source_urls"] == [_MIRROR_B]


def test_fulfiller_mirror_equal_to_the_requesters_primary_is_dropped(
    db, author, second_user, conflict, capture_source_tag
):
    """The primary the mirrors are normalized against is the KEPT anchor, not the
    fulfiller's submitted ``source_url``: on a `requested` row the requester's
    primary stays, so a fulfiller who lists it among the mirrors has it dropped."""
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_REQUESTED,
        source_url=_PRIMARY,
        with_media=True,
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, second_user),
        data=_geolocate_form(
            conflict,
            capture_source_tag,
            source_url="https://x.com/fulfiller/status/9",
            secondary_source_urls=[_PRIMARY, _MIRROR_B],
        ),
        files=[proof_file_part()],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_url"] == _PRIMARY
    assert body["secondary_source_urls"] == [_MIRROR_B]


def test_geolocate_rejects_more_links_than_the_cap(db, author, conflict, capture_source_tag):
    geo = _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url=_PRIMARY,
        source_url=_PRIMARY,
        with_media=True,
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        headers=login_as(client, author),
        data=_geolocate_form(
            conflict,
            capture_source_tag,
            secondary_source_urls=[
                f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS + 1)
            ],
        ),
        files=[proof_file_part()],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_source_links"


# ── Ingest prefill: the truncating variant ────────────────────────────────


def test_truncate_keeps_the_first_ten_in_order():
    """The machine path can't report a cap breach to anyone, so it drops the
    over-cap links instead of raising: the first ten survive, in order."""
    submitted = [
        f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS + 2)
    ]
    assert (
        truncate_secondary_source_urls(submitted, _PRIMARY)
        == (submitted[:MAX_SECONDARY_SOURCE_LINKS])
    )


def test_truncate_cleans_before_it_caps():
    """Blanks, duplicates and the primary are stripped FIRST, so the junk a
    tweet carried doesn't spend slots a real mirror needed."""
    submitted = [
        f"https://mirror.example/{index}" for index in range(MAX_SECONDARY_SOURCE_LINKS + 2)
    ]
    noisy = ["", f"  {_PRIMARY}  ", "   ", *submitted, submitted[0], f" {submitted[1]} "]
    assert (
        truncate_secondary_source_urls(noisy, _PRIMARY) == (submitted[:MAX_SECONDARY_SOURCE_LINKS])
    )


# ── Cascade ───────────────────────────────────────────────────────────────


def test_hard_delete_cascades_to_the_links(db, author):
    """The ``event_id`` FK cascade drops the child rows, so an owner delete
    can't strand orphan links."""
    geo = _make_geo(db, author=author, secondary_source_urls=[_MIRROR_A, _MIRROR_B])
    geo_id = geo.id
    response = client.delete(f"/api/v1/events/{geo_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(EventSourceLink).filter(EventSourceLink.event_id == geo_id).count() == 0


# ── Duplicate probe: the child-table leg ──────────────────────────────────


def test_possible_duplicates_matches_a_secondary_link_host(db, author):
    """The analyst pastes the mirror; the existing event recorded it as a
    SECONDARY link while its primary anchor points at another network. Same
    event, so the probe must surface it."""
    geo = Event(
        owner_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://x.com/a/status/1",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.flush()
    db.add(EventSourceLink(event_id=geo.id, position=0, url="https://mirrorsite.example/post/7"))
    db.commit()

    response = client.get(
        "/api/v1/events/possible-duplicates",
        headers=login_as(client, author),
        params={
            "lat": 48.5,
            "lng": 34.5,
            "source_url": "https://mirrorsite.example/post/9",
        },
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(geo.id)]
