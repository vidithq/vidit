"""The author-set ``is_graphic`` flag.

Each source carries its own flag, which ratchets on edit (only admin moderation clears it).
The event's flag is derived from its sources, and both read payloads carry it.
"""

from __future__ import annotations

import json

from app.models.event import STATUS_DETECTED, Event
from app.models.source import Source
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    filed_source,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
)


def _create_form(conflict, sources: str):
    return {
        "title": "Graphic flag probe",
        "lat": "0.0",
        "lng": "0.0",
        "occurred_date": "2026-05-01",
        "proof": proof_form_field(),
        "conflict_ids": json.dumps([str(conflict.id)]),
        "sources": sources,
    }


def _graphic_detection(db, author) -> Event:
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        with_media=True,
        is_graphic=True,
        detected_from_url="https://x/1",
    )


def _kept(source: Source, **extra) -> dict:
    """The stored source posted back by id with its own file."""
    return source_spec(id=str(source.id), media_id=str(source.media.id), **extra)


def _geolocate(geo: Event, user, conflict, sources: str):
    return client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data={
            "title": "Edited title",
            "lat": "50.0",
            "lng": "30.0",
            "occurred_date": "2026-05-01",
            "proof": proof_form_field(),
            "conflict_ids": json.dumps([str(conflict.id)]),
            "sources": sources,
        },
        files=[proof_file_part()],
        headers=login_as(client, user),
    )


def _source_flags(db, event_id) -> list[bool]:
    db.expire_all()
    return [s.is_graphic for s in db.query(Event).filter(Event.id == event_id).one().sources]


def test_create_defaults_to_not_graphic(db, author, conflict):
    """A source that omits the field is unflagged, and so is its event."""
    sources = filed_source(author)
    response = client.post(
        "/api/v1/events",
        data=_create_form(conflict, sources),
        files=[proof_file_part()],
        headers=login_as(client, author),
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_graphic"] is False
    assert _source_flags(db, response.json()["id"]) == [False]


def test_request_records_the_declared_flag(db, author):
    """A request declares the flag on the same terms as a direct submit."""
    sources = filed_source(author, is_graphic=True)
    response = client.post(
        "/api/v1/events/requests",
        data={"title": "Graphic request", "sources": sources},
        headers=login_as(client, author),
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_graphic"] is True
    assert [s["is_graphic"] for s in response.json()["sources"]] == [True]


def test_geolocate_sets_the_flag_on_a_stored_source(db, author, conflict):
    geo = _make_geo(
        db, author=author, status=STATUS_DETECTED, with_media=True, detected_from_url="https://x/2"
    )
    response = _geolocate(
        geo, author, conflict, sources_field(_kept(geo.sources[0], is_graphic=True))
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True
    assert _source_flags(db, geo.id) == [True]


def test_geolocate_cannot_clear_a_stored_sources_flag(db, author, conflict):
    """A posted false leaves a flagged source flagged, unlike every other form field."""
    geo = _graphic_detection(db, author)
    response = _geolocate(
        geo, author, conflict, sources_field(_kept(geo.sources[0], is_graphic=False))
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is True
    assert _source_flags(db, geo.id) == [True]


def test_the_ratchet_holds_per_source(db, author, conflict):
    """A new source beside a flagged one takes its own declared flag."""
    geo = _graphic_detection(db, author)
    sources = sources_field(
        _kept(geo.sources[0]),
        source_spec("https://ctx.example/report", level="context", sensor=None),
    )
    response = _geolocate(geo, author, conflict, sources)
    assert response.status_code == 200, response.text
    assert [(s["level"], s["is_graphic"]) for s in response.json()["sources"]] == [
        ("direct", True),
        ("context", False),
    ]


def test_dropping_the_only_graphic_source_unflags_the_event(db, author, conflict):
    """The event flag is derived, so it follows the sources the event still holds."""
    geo = _graphic_detection(db, author)
    response = _geolocate(geo, author, conflict, filed_source(author))
    assert response.status_code == 200, response.text
    assert response.json()["is_graphic"] is False
    db.expire_all()
    assert db.query(Event).filter(Event.id == geo.id).one().is_graphic is False


def test_admin_moderation_sets_and_clears_every_source(db, author, admin_user):
    """An admin unmark clears a flag the form cannot, on every source of the event."""
    geo = _make_geo(
        db,
        author=author,
        is_graphic=True,
        secondary_source_urls=["https://t.me/c/2", "https://t.me/c/3"],
    )
    assert _source_flags(db, geo.id) == [True, False, False]
    headers = login_as(client, admin_user)

    unmark = client.patch(
        f"/api/v1/admin/events/{geo.id}/moderation", json={"is_graphic": False}, headers=headers
    )
    assert unmark.status_code == 200, unmark.text
    assert unmark.json()["is_graphic"] is False
    assert _source_flags(db, geo.id) == [False, False, False]

    mark = client.patch(
        f"/api/v1/admin/events/{geo.id}/moderation", json={"is_graphic": True}, headers=headers
    )
    assert mark.status_code == 200, mark.text
    assert mark.json()["is_graphic"] is True
    assert _source_flags(db, geo.id) == [True, True, True]


def test_flag_travels_on_the_list_and_detail_payloads(db, author):
    """Both read shapes carry the flag, so no second request is needed."""
    graphic = _make_geo(db, author=author, is_graphic=True)
    plain = _make_geo(db, author=author)

    listing = client.get("/api/v1/events")
    assert listing.status_code == 200
    by_id = {row["id"]: row for row in listing.json()}
    assert by_id[str(graphic.id)]["is_graphic"] is True
    assert by_id[str(plain.id)]["is_graphic"] is False

    detail = client.get(f"/api/v1/events/{graphic.id}")
    assert detail.status_code == 200
    assert detail.json()["is_graphic"] is True
    assert [s["is_graphic"] for s in detail.json()["sources"]] == [True]
