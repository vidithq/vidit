"""Owner mutation lifecycle for events.

`DELETE` (hard delete, owner-only) plus the machine-`detected` owner flow:
`POST .../geolocate` (writes the owner's edits and flips the row to
`geolocated`) and `POST .../close` (the owner rejects the detection; the row
stays visible with ``before_closed_status='detected'`` and is re-importable).
Close is state-gated to `requested` / `detected`; geolocate accepts `detected`
(owner-only) or `requested` (anyone). Shared fixtures live in `conftest.py`;
`client` / `_make_geo` / the proof helpers in `_helpers.py`.
"""

from __future__ import annotations

import json
import uuid

from app.models.event import STATUS_CLOSED, STATUS_DETECTED, STATUS_GEOLOCATED, Event
from tests.conftest import login_as
from tests.events._helpers import (
    _make_geo,
    client,
    proof_file_part,
    proof_form_field,
)

# ── DELETE /events/{id} ───────────────────────────────────────────────────


def test_delete_requires_authentication(db, author):
    geo = _make_geo(db, author=author)
    response = client.delete(f"/api/v1/events/{geo.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_unknown_id(author):
    response = client.delete(f"/api/v1/events/{uuid.uuid4()}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_404_for_soft_deleted(db, author):
    """Admin already removed it; the owner sees the same 404 surface.

    Same observed behaviour as an unknown id, the owner can't infer
    that "an admin reached in and removed this," only that the row is
    gone from their perspective.
    """
    geo = _make_geo(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/events/{geo.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_owner(db, author, second_user):
    geo = _make_geo(db, author=author)
    response = client.delete(f"/api/v1/events/{geo.id}", headers=login_as(client, second_user))
    assert response.status_code == 403


def test_delete_succeeds_for_owner_and_removes_row(db, author):
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = client.delete(f"/api/v1/events/{geo_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Event).filter(Event.id == geo_id).first() is None


def test_delete_invalidates_points_cache(db, author):
    """The map gets stale instantly when the owner drops a row.

    Without this, anyone holding a cached `/points` response would see
    the deleted row's marker for up to the cache TTL.
    """
    geo = _make_geo(db, author=author)
    # Warm the cache
    first = client.get("/api/v1/events/points")
    assert first.headers.get("x-cache") == "MISS"
    warm = client.get("/api/v1/events/points")
    assert warm.headers.get("x-cache") == "HIT"

    client.delete(f"/api/v1/events/{geo.id}", headers=login_as(client, author))

    # After delete the cache must be cold again
    after = client.get("/api/v1/events/points")
    assert after.headers.get("x-cache") == "MISS", "delete must invalidate the points cache"


# ── Owner flow: POST .../geolocate / POST .../close ────────────────────────
# Close is owner-only and state-gated to ``requested`` / ``detected``; a
# ``geolocated`` row is frozen. Geolocate writes the owner's edits AND flips a
# ``detected`` (owner-only) or ``requested`` (anyone) row to ``geolocated`` in
# one step (the create-time evidence floor is enforced there). The detected →
# geolocated freeze and the close-then-re-import recreate seam
# (test_detection.py) are what these lock in.


def _detected(db, author, **kwargs):
    """A machine ``detected`` row, born tagless unless ``tags`` is passed."""
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url="https://x.com/a/status/1",
        **kwargs,
    )


# ── POST /events/{id}/geolocate: write the form + freeze ──────────────────


def _geolocate_form(**overrides):
    """A complete geolocate form (it posts the whole state, like create).

    Override per test; ``tag_ids`` / ``remove_media_ids`` are JSON. Carries no
    tags and no proof image by default, so a bare form fails the floor unless
    ``_floor_form`` (+ ``_floor_files``) is used.
    """
    form = {
        "title": "Edited title",
        "lat": "50.0",
        "lng": "30.0",
        "source_url": "https://x.com/a/status/1",
        "event_date": "2026-05-01",
        "source_posted_at": "2026-05-01T12:00",
    }
    form.update(overrides)
    return form


def _floor_form(conflict, capture_source_tag, **overrides):
    """A geolocate form that meets the conflict + tag + proof-image floor. Pair with a
    ``with_media=True`` row (and ``files=_floor_files()``) to clear it all."""
    return _geolocate_form(
        tag_ids=json.dumps([str(capture_source_tag.id)]),
        conflict_ids=json.dumps([str(conflict.id)]),
        proof=proof_form_field(),
        **overrides,
    )


def _floor_files():
    return [proof_file_part()]


def test_geolocate_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/events/{geo.id}/geolocate", data=_geolocate_form())
    assert response.status_code == 401


def test_geolocate_returns_404_for_unknown_id(author):
    response = client.post(
        f"/api/v1/events/{uuid.uuid4()}/geolocate",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_geolocate_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_geolocate_returns_403_when_not_owner(db, author, second_user):
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(),
        headers=login_as(client, second_user),
    )
    assert response.status_code == 403


def test_geolocate_rejects_geolocated_row(db, author):
    """A ``geolocated`` row is frozen, geolocate 409s with the invalid_state code."""
    geo = _make_geo(db, author=author)  # default status = geolocated
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_geolocate_writes_fields_and_freezes(db, author, conflict, capture_source_tag):
    """Geolocate writes the whole form and flips the row to ``geolocated``."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(
            conflict,
            capture_source_tag,
            title="Completed title",
            lat="50.25",
            lng="30.5",
            capture_source_lat="50.3",
            capture_source_lng="30.6",
            event_date="2026-07-01",
            source_posted_at="2026-06-30T07:45",
        ),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Completed title"
    assert body["event_coords"] == {"lat": 50.25, "lng": 30.5}
    assert body["capture_source_coords"] == {"lat": 50.3, "lng": 30.6}
    assert body["event_date"] == "2026-07-01"
    assert body["source_posted_at"].startswith("2026-06-30T07:45")
    assert {t["id"] for t in body["tags"]} == {str(capture_source_tag.id)}
    assert {c["id"] for c in body["conflicts"]} == {str(conflict.id)}
    # Geolocate freezes it: a detected row becomes geolocated, stamped, and
    # the owner lands in the durable credit table.
    assert body["status"] == "geolocated"
    assert body["geolocated_at"] is not None
    assert [g["username"] for g in body["geolocators"]] == [author.username]

    db.expire_all()
    refreshed = db.query(Event).filter(Event.id == geo.id).one()
    assert refreshed.title == "Completed title"
    assert refreshed.status == STATUS_GEOLOCATED


def test_geolocate_applies_source_url_but_ignores_provenance_and_state(
    db, author, conflict, capture_source_tag
):
    """The owner curates the form: ``source_url`` is editable. Only
    ``detected_from_url`` (provenance) and ``status`` have no field, so sending
    them is silently ignored. The row ends ``geolocated`` via the verb itself."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(
            conflict,
            capture_source_tag,
            source_url="https://example.com/new-source",
            detected_from_url="https://evil.example/swap",  # ignored, no field
            status="detected",  # ignored, no field
        ),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_url"] == "https://example.com/new-source"  # editable
    assert body["detected_from_url"] == "https://x.com/a/status/1"  # immutable
    assert body["status"] == "geolocated"  # set by the verb, not the ignored field


def test_geolocate_source_posted_at_round_trips(db, author, conflict, capture_source_tag):
    """source_posted_at is part of the full form and round-trips; it's required
    (a post always has a time)."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(conflict, capture_source_tag, source_posted_at="2026-06-30T13:20"),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    assert response.json()["source_posted_at"].startswith("2026-06-30T13:20")


def test_geolocate_rejects_out_of_range_coordinate(db, author):
    """Coordinate validation runs before the floor, so a bad coord 400s even on a
    bare form."""
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(lat="200.0"),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_geolocate_blocked_without_media(db, author, conflict, capture_source_tag):
    """The evidence floor is enforced at the transition: no source media
    (kept + new) 400s."""
    geo = _detected(db, author, with_media=False)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(conflict, capture_source_tag),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"


def test_geolocate_blocked_without_proof_image(db, author, conflict, capture_source_tag):
    """A proof body with no inline image fails the floor: a vouched location
    needs a visual argument."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(
            tag_ids=json.dumps([str(capture_source_tag.id)]),
            conflict_ids=json.dumps([str(conflict.id)]),
        ),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "proof_image_required"


def test_geolocate_blocked_without_required_tags(db, author):
    """A detected row is born tagless; the transition enforces the conflict +
    capture_source floor the machine path skipped."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(proof=proof_form_field()),  # no tag_ids
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_geolocate_blocked_with_partial_tags(db, author, conflict):
    """A conflict alone isn't enough; capture_source is still required."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_geolocate_form(conflict_ids=json.dumps([str(conflict.id)]), proof=proof_form_field()),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_geolocate_freezes_against_resubmit(db, author, conflict, capture_source_tag):
    """After the transition the row is ``geolocated``; a follow-up geolocate 409s."""
    geo = _detected(db, author, with_media=True)
    ok = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(conflict, capture_source_tag),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "geolocated"

    frozen = client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(conflict, capture_source_tag),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert frozen.status_code == 409
    assert frozen.json()["detail"]["code"] == "invalid_state"


def test_geolocate_invalidates_points_cache(db, author, conflict, capture_source_tag):
    geo = _detected(db, author, with_media=True)
    assert client.get("/api/v1/events/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/events/points").headers.get("x-cache") == "HIT"
    client.post(
        f"/api/v1/events/{geo.id}/geolocate",
        data=_floor_form(conflict, capture_source_tag),
        files=_floor_files(),
        headers=login_as(client, author),
    )
    assert client.get("/api/v1/events/points").headers.get("x-cache") == "MISS"


# ── POST /events/{id}/close (reject a detection) ───────────────────────────


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


def test_close_rejects_geolocated_row(db, author):
    geo = _make_geo(db, author=author)  # geolocated, DELETE owns its removal
    response = _close(geo.id, author)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_close_keeps_detected_row_visible(db, author):
    """Closing a detection records the rejection instead of hiding the row:
    the event stays publicly readable with ``before_closed_status='detected'``
    and the reason attached (re-import recreates a fresh pair, covered in
    test_detection.py)."""
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
    # Still readable on the public detail surface, and routed to the located
    # view's closed cohort (not the requested queue).
    detail = client.get(f"/api/v1/events/{geo_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == STATUS_CLOSED
    located_ids = {r["id"] for r in client.get("/api/v1/events").json()}
    assert str(geo_id) in located_ids
    requested_ids = {r["id"] for r in client.get("/api/v1/events?view=requested").json()}
    assert str(geo_id) not in requested_ids


def test_closed_detection_leaves_the_map(db, author):
    """A rejected detection comes off ``/points``, the map shows live
    confidence, the list keeps the audit trail."""
    geo = _detected(db, author)
    points = {row[0] for row in client.get("/api/v1/events/points").json()}
    assert str(geo.id) in points

    assert _close(geo.id, author).status_code == 200

    after = {row[0] for row in client.get("/api/v1/events/points").json()}
    assert str(geo.id) not in after


def test_close_invalidates_points_cache(db, author):
    geo = _detected(db, author)
    assert client.get("/api/v1/events/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/events/points").headers.get("x-cache") == "HIT"
    _close(geo.id, author)
    after = client.get("/api/v1/events/points")
    assert after.headers.get("x-cache") == "MISS"
