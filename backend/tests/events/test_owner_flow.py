"""Owner flow: the publish through `POST .../versions` and `POST .../close`, plus the absence of an owner delete."""

from __future__ import annotations

import json
import uuid

from app.models.event import STATUS_CLOSED, STATUS_DETECTED, STATUS_GEOLOCATED, Event
from tests.conftest import login_as
from tests.events._helpers import (
    WORLD_BBOX,
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
)


def test_owner_has_no_delete_verb(db, author):
    """The path serves no ``DELETE``: the owner closes a row, an admin destroys it."""
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = client.delete(f"/api/v1/events/{geo_id}", headers=login_as(client, author))
    assert response.status_code == 405
    db.expire_all()
    assert db.query(Event).filter(Event.id == geo_id).first() is not None


def test_admin_hard_delete_still_removes_the_row(db, author, admin_user):
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = client.delete(
        f"/api/v1/admin/events/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.query(Event).filter(Event.id == geo_id).first() is None


DETECTION_URL = "https://x.com/a/status/1"


def _detected(db, author, **kwargs):
    """A machine ``detected`` row, born tagless unless ``tags`` is passed."""
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url=DETECTION_URL,
        source_url=DETECTION_URL,
        **kwargs,
    )


def _kept(geo, url=DETECTION_URL, **kw) -> str:
    """The ``sources`` field re-posting the row's one source by ``id``, with its file if any."""
    [source] = geo.sources
    media_id = str(source.media.id) if source.media is not None else None
    return sources_field(source_spec(url, id=str(source.id), media_id=media_id, **kw))


def _geolocate_form(**overrides):
    """A bare form: no conflict and no proof image, so it fails the floor without
    ``_floor_form``."""
    form = {
        "title": "Edited title",
        "lat": "50.0",
        "lng": "30.0",
        "occurred_date": "2026-05-01",
        "sources": sources_field(source_spec(DETECTION_URL)),
    }
    form.update(overrides)
    return form


def _floor_form(conflict, geo, **overrides):
    """A form that meets the floor; pair with a ``with_media=True`` row and ``_floor_files()``."""
    overrides.setdefault("sources", _kept(geo))
    return _geolocate_form(
        conflict_ids=json.dumps([str(conflict.id)]),
        proof=proof_form_field(),
        **overrides,
    )


def _floor_files():
    return [proof_file_part()]


def test_geolocate_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/events/{geo.id}/versions", data=_geolocate_form())
    assert response.status_code == 401


def test_geolocate_returns_404_for_unknown_id(author):
    response = client.post(
        f"/api/v1/events/{uuid.uuid4()}/versions",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_geolocate_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_geolocate_returns_403_when_not_owner(db, author, second_user):
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(),
        headers=login_as(client, second_user),
    )
    assert response.status_code == 403


def test_a_publish_form_is_refused_on_a_published_row(db, author):
    """A form loaded at version 0 cannot land on a row that is already version 1."""
    geo = _make_geo(db, author=author)  # default status = geolocated
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(version_no="0"),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "version_mismatch"


def test_publishing_a_closed_row_is_refused(db, author):
    geo = _make_geo(db, author=author, status=STATUS_DETECTED)
    client.post(
        f"/api/v1/events/{geo.id}/close",
        json={"close_reason": "Not mine"},
        headers=login_as(client, author),
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_geolocate_writes_fields_and_freezes(db, author, conflict):
    """The whole form lands, the source's capture details included; no tag is required."""
    geo = _detected(db, author, with_media=True, kind="unknown")
    sources = _kept(
        geo,
        kind="drone",
        capture_position={"lat": 50.3, "lng": 30.6},
        posted_at="2026-06-30T07:45",
    )
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(
            conflict,
            geo,
            title="Completed title",
            lat="50.25",
            lng="30.5",
            occurred_date="2026-07-01",
            sources=sources,
        ),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Completed title"
    assert body["coords"] == {"lat": 50.25, "lng": 30.5}
    assert body["occurred_date"] == "2026-07-01"
    [source] = body["sources"]
    assert source["kind"] == "drone"
    assert source["capture_position"] == {"lat": 50.3, "lng": 30.6}
    assert source["links"][0]["posted_at"].startswith("2026-06-30T07:45")
    assert body["tags"] == []
    assert {c["id"] for c in body["conflicts"]} == {str(conflict.id)}
    # The owner lands in the durable credit table.
    assert body["status"] == "geolocated"
    assert [g["username"] for g in body["geolocators"]] == [author.username]

    db.expire_all()
    refreshed = db.query(Event).filter(Event.id == geo.id).one()
    assert refreshed.title == "Completed title"
    assert refreshed.status == STATUS_GEOLOCATED
    # The state-entry stamp is a column, not a wire field.
    assert refreshed.geolocated_at is not None


def test_geolocate_accepts_missing_occurred_date(db, author, conflict):
    """A null date reads as Unknown: footage does not always establish when it happened."""
    geo = _detected(db, author, with_media=True)
    form = _floor_form(conflict, geo)
    del form["occurred_date"]
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=form,
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "geolocated"
    assert body["occurred_date"] is None


def test_geolocate_applies_the_sources_but_ignores_provenance_and_state(db, author, conflict):
    """The owner curates the form: the sources are editable. Only
    ``detected_from_url`` (provenance) and ``status`` have no field, so sending
    them is silently ignored. The row ends ``geolocated`` via the verb itself."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(
            conflict,
            geo,
            sources=_kept(geo, url="https://example.com/new-source"),
            detected_from_url="https://evil.example/swap",  # ignored, no field
            status="detected",  # ignored, no field
        ),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert [link["url"] for link in body["sources"][0]["links"]] == [
        "https://example.com/new-source"
    ]
    assert body["detected_from_url"] == DETECTION_URL  # immutable
    assert body["status"] == "geolocated"  # set by the verb, not the ignored field


def test_geolocate_rejects_out_of_range_coordinate(db, author):
    """Coordinate validation runs before the floor, so a bare form still 400s."""
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(lat="200.0"),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_geolocate_blocked_without_media(db, author, conflict):
    geo = _detected(db, author, with_media=False)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(conflict, geo),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "source_file_required"


def test_geolocate_blocked_without_proof_image(db, author, conflict):
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(conflict_ids=json.dumps([str(conflict.id)]), sources=_kept(geo)),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"


def test_geolocate_blocked_without_a_conflict(db, author):
    """A detected row is born without one; geolocate enforces the floor the machine path
    skipped."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_geolocate_form(proof=proof_form_field(), sources=_kept(geo)),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "conflict_required"


def test_geolocate_freezes_against_resubmit(db, author, conflict):
    geo = _detected(db, author, with_media=True)
    ok = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(conflict, geo, version_no="0"),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "geolocated"
    assert ok.json()["version_no"] == 1

    frozen = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(conflict, geo, version_no="0"),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert frozen.status_code == 409
    assert frozen.json()["detail"]["code"] == "version_mismatch"


def test_geolocate_invalidates_points_cache(db, author, conflict):
    geo = _detected(db, author, with_media=True)
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").headers.get("x-cache") == "MISS"
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").headers.get("x-cache") == "HIT"
    client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(conflict, geo),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").headers.get("x-cache") == "MISS"


def _close(geo_id, user, reason="Not the claimed location"):
    return client.post(
        f"/api/v1/events/{geo_id}/close",
        headers=login_as(client, user),
        json={"close_reason": reason},
    )


def test_close_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/events/{geo.id}/close", json={"close_reason": "x"})
    assert response.status_code == 401


def test_close_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = _close(geo.id, author)
    assert response.status_code == 404


def test_close_returns_403_when_not_owner(db, author, second_user):
    geo = _detected(db, author)
    response = _close(geo.id, second_user)
    assert response.status_code == 403


def test_close_retracts_a_published_row(db, author):
    """The closed page keeps the id, coordinate and reason as the record of a retracted claim."""
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = _close(geo_id, author, reason="Wrong village, corrected elsewhere")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["before_closed_status"] == STATUS_GEOLOCATED
    assert body["close_reason"] == "Wrong village, corrected elsewhere"
    assert body["closed_at"] is not None
    assert body["id"] == str(geo_id)
    assert body["coords"] is not None

    detail = client.get(f"/api/v1/events/{geo_id}")
    assert detail.status_code == 200
    assert detail.json()["before_closed_status"] == STATUS_GEOLOCATED


def test_retraction_leaves_the_read_views_and_the_map(db, author):
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    assert str(geo_id) in {r["id"] for r in client.get("/api/v1/events").json()}
    assert str(geo_id) in {
        row[0] for row in client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").json()
    }

    assert _close(geo_id, author).status_code == 200

    assert str(geo_id) not in {r["id"] for r in client.get("/api/v1/events").json()}
    assert str(geo_id) not in {r["id"] for r in client.get("/api/v1/events?view=requested").json()}
    assert str(geo_id) not in {
        row[0] for row in client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").json()
    }


def test_retraction_leaves_the_published_feed_and_count(db, author):
    """``published_events`` backs both the profile feed and its count."""
    geo = _make_geo(db, author=author)

    def feed():
        body = client.get(f"/api/v1/users/{author.username}/events").json()
        return {r["id"] for r in body["items"]}

    before = client.get(f"/api/v1/users/{author.username}").json()["geolocations_count"]
    assert str(geo.id) in feed()

    assert _close(geo.id, author).status_code == 200

    after = client.get(f"/api/v1/users/{author.username}").json()["geolocations_count"]
    assert after == before - 1
    assert str(geo.id) not in feed()


def test_close_rejects_an_already_closed_row(db, author):
    geo = _make_geo(db, author=author)
    assert _close(geo.id, author).status_code == 200
    response = _close(geo.id, author)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_retracted_row_cannot_be_edited(db, author, conflict):
    geo = _make_geo(db, author=author)
    assert _close(geo.id, author).status_code == 200
    response = client.post(
        f"/api/v1/events/{geo.id}/versions",
        data=_floor_form(conflict, geo),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_close_keeps_detected_row_visible(db, author):
    """A rejected detection stays publicly readable instead of being hidden."""
    geo = _detected(db, author)
    geo_id = geo.id
    response = _close(geo_id, author, reason="Bot misread the coordinates")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == STATUS_CLOSED
    assert body["before_closed_status"] == "detected"
    assert body["close_reason"] == "Bot misread the coordinates"
    assert body["closed_at"] is not None

    db.expire_all()
    row = db.query(Event).filter(Event.id == geo_id).one()
    assert row.deleted_at is None  # visible, not soft-deleted
    detail = client.get(f"/api/v1/events/{geo_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == STATUS_CLOSED
    located_ids = {r["id"] for r in client.get("/api/v1/events").json()}
    assert str(geo_id) in located_ids
    requested_ids = {r["id"] for r in client.get("/api/v1/events?view=requested").json()}
    assert str(geo_id) not in requested_ids


def test_closed_detection_leaves_the_map(db, author):
    """The map shows live confidence only; the list keeps the audit trail."""
    geo = _detected(db, author)
    points = {row[0] for row in client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").json()}
    assert str(geo.id) in points

    assert _close(geo.id, author).status_code == 200

    after = {row[0] for row in client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").json()}
    assert str(geo.id) not in after


def test_close_invalidates_points_cache(db, author):
    geo = _detected(db, author)
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").headers.get("x-cache") == "MISS"
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").headers.get("x-cache") == "HIT"
    _close(geo.id, author)
    after = client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}")
    assert after.headers.get("x-cache") == "MISS"
