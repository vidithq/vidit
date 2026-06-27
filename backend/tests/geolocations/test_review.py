"""Owner mutation lifecycle for `/geolocations`.

`DELETE` (hard delete, author-only) plus the machine-`detected` review flow —
`PATCH` edit, `POST .../validate` (freezes the row), `POST .../reject`
(soft-delete, re-importable). All state-gated to `detected`. Shared fixtures
live in `conftest.py`; `client` / `_make_geo` in `_helpers.py`.
"""

from __future__ import annotations

import json
import uuid

from app.models.geolocation import STATE_DETECTED, STATE_VALIDATED, Geolocation
from tests.conftest import login_as
from tests.geolocations._helpers import _make_geo, client

# ── DELETE /geolocations/{id} ─────────────────────────────────────────────


def test_delete_requires_authentication(db, author):
    geo = _make_geo(db, author=author)
    response = client.delete(f"/api/v1/geolocations/{geo.id}")
    assert response.status_code == 401


def test_delete_returns_404_for_unknown_id(author):
    response = client.delete(
        f"/api/v1/geolocations/{uuid.uuid4()}", headers=login_as(client, author)
    )
    assert response.status_code == 404


def test_delete_returns_404_for_soft_deleted(db, author):
    """Admin already removed it; the author sees the same 404 surface.

    Same observed behaviour as an unknown id — the author can't infer
    that "an admin reached in and removed this," only that the row is
    gone from their perspective.
    """
    geo = _make_geo(db, author=author, deleted=True)
    response = client.delete(f"/api/v1/geolocations/{geo.id}", headers=login_as(client, author))
    assert response.status_code == 404


def test_delete_returns_403_when_not_author(db, author, second_user):
    geo = _make_geo(db, author=author)
    response = client.delete(
        f"/api/v1/geolocations/{geo.id}", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_delete_succeeds_for_author_and_removes_row(db, author):
    geo = _make_geo(db, author=author)
    geo_id = geo.id
    response = client.delete(f"/api/v1/geolocations/{geo_id}", headers=login_as(client, author))
    assert response.status_code == 204
    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == geo_id).first() is None


def test_delete_invalidates_points_cache(db, author):
    """The map gets stale instantly when the author drops a row.

    Without this, anyone holding a cached `/points` response would see
    the deleted row's marker for up to the cache TTL.
    """
    geo = _make_geo(db, author=author)
    # Warm the cache
    first = client.get("/api/v1/geolocations/points")
    assert first.headers.get("x-cache") == "MISS"
    warm = client.get("/api/v1/geolocations/points")
    assert warm.headers.get("x-cache") == "HIT"

    client.delete(f"/api/v1/geolocations/{geo.id}", headers=login_as(client, author))

    # After delete the cache must be cold again
    after = client.get("/api/v1/geolocations/points")
    assert after.headers.get("x-cache") == "MISS", "delete must invalidate the points cache"


# ── Owner review flow: PATCH edit / POST validate / POST reject ────────────
# All three are owner-only and state-gated to ``detected``; a ``validated``
# row is frozen. The detected → validated freeze and the soft-delete-then-
# re-import recreate seam (test_detection.py::
# test_idempotency_recreates_soft_deleted_pair) are what these lock in.


def _detected(db, author, **kwargs):
    """A machine ``detected`` row — born tagless unless ``tags`` is passed."""
    return _make_geo(
        db,
        author=author,
        state=STATE_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url="https://x.com/a/status/1",
        **kwargs,
    )


# ── PATCH /geolocations/{id} — edit (multipart full edit, like submit) ─────


def _edit_form(**overrides):
    """A complete edit form — the PATCH posts the whole editable state, like
    submit. Override per test; ``tag_ids`` / ``remove_media_ids`` are JSON."""
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


def test_update_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.patch(f"/api/v1/geolocations/{geo.id}", data=_edit_form())
    assert response.status_code == 401


def test_update_returns_404_for_unknown_id(author):
    response = client.patch(
        f"/api/v1/geolocations/{uuid.uuid4()}",
        data=_edit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_update_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_update_returns_403_when_not_author(db, author, second_user):
    geo = _detected(db, author)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(),
        headers=login_as(client, second_user),
    )
    assert response.status_code == 403


def test_update_rejects_validated_row(db, author):
    """A validated row is frozen — edits 409 with the invalid_state code."""
    geo = _make_geo(db, author=author)  # default state = validated
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_update_edits_detected_fields(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(
            title="Completed title",
            lat="50.25",
            lng="30.5",
            event_date="2026-07-01",
            source_posted_at="2026-06-30T07:45",
            tag_ids=json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        ),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Completed title"
    assert body["lat"] == 50.25
    assert body["lng"] == 30.5
    assert body["event_date"] == "2026-07-01"
    assert body["source_posted_at"].startswith("2026-06-30T07:45")
    assert {t["id"] for t in body["tags"]} == {str(conflict_tag.id), str(capture_source_tag.id)}
    # Stays detected — edit completes the row, validate is the separate step.
    assert body["state"] == "detected"

    db.expire_all()
    refreshed = db.query(Geolocation).filter(Geolocation.id == geo.id).one()
    assert refreshed.title == "Completed title"


def test_update_applies_source_url_but_ignores_provenance_and_state(db, author):
    """The owner curates the draft: ``source_url`` is editable. Only
    ``detected_from_url`` (provenance) and ``state`` have no field, so sending
    them is silently ignored, not honoured."""
    geo = _detected(db, author)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(
            title="Edited",
            source_url="https://example.com/new-source",
            detected_from_url="https://evil.example/swap",  # ignored — no field
            state="validated",  # ignored — no field
        ),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_url"] == "https://example.com/new-source"  # now editable
    assert body["detected_from_url"] == "https://x.com/a/status/1"  # immutable
    assert body["state"] == "detected"  # immutable


def test_update_source_posted_at_round_trips(db, author):
    """source_posted_at is part of the full edit and round-trips — it's required
    (a post always has a time), so it can't be cleared."""
    geo = _detected(db, author)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(source_posted_at="2026-06-30T13:20"),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    assert response.json()["source_posted_at"].startswith("2026-06-30T13:20")


def test_update_rejects_out_of_range_coordinate(db, author):
    geo = _detected(db, author)
    response = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(lat="200.0"),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_update_invalidates_points_cache(db, author):
    geo = _detected(db, author)
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "HIT"
    client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(),
        headers=login_as(client, author),
    )
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"


# ── POST /geolocations/{id}/validate ───────────────────────────────────────


def test_validate_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/geolocations/{geo.id}/validate")
    assert response.status_code == 401


def test_validate_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 404


def test_validate_returns_403_when_not_author(db, author, second_user):
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_validate_rejects_already_validated(db, author):
    geo = _make_geo(db, author=author)  # already validated
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_validate_blocked_without_media(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author, tags=[conflict_tag, capture_source_tag], with_media=False)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"


def test_validate_blocked_without_required_tags(db, author):
    """A detected row is born tagless; validate enforces the conflict +
    capture_source floor the create path skips for machine rows."""
    geo = _detected(db, author, with_media=True)  # media but no tags
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_validate_blocked_with_partial_tags(db, author, conflict_tag):
    """conflict alone isn't enough — capture_source is still required."""
    geo = _detected(db, author, tags=[conflict_tag], with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_validate_succeeds_and_freezes(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author, tags=[conflict_tag, capture_source_tag], with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author)
    )
    assert response.status_code == 200
    assert response.json()["state"] == "validated"

    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == geo.id).one().state == STATE_VALIDATED

    # Frozen: a follow-up edit now 409s.
    frozen = client.patch(
        f"/api/v1/geolocations/{geo.id}",
        data=_edit_form(),
        headers=login_as(client, author),
    )
    assert frozen.status_code == 409


def test_validate_invalidates_points_cache(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author, tags=[conflict_tag, capture_source_tag], with_media=True)
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "HIT"
    client.post(f"/api/v1/geolocations/{geo.id}/validate", headers=login_as(client, author))
    after = client.get("/api/v1/geolocations/points")
    assert after.headers.get("x-cache") == "MISS"


# ── POST /geolocations/{id}/reject ─────────────────────────────────────────


def test_reject_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/geolocations/{geo.id}/reject")
    assert response.status_code == 401


def test_reject_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/reject", headers=login_as(client, author)
    )
    assert response.status_code == 404


def test_reject_returns_403_when_not_author(db, author, second_user):
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/reject", headers=login_as(client, second_user)
    )
    assert response.status_code == 403


def test_reject_rejects_validated_row(db, author):
    geo = _make_geo(db, author=author)  # validated — DELETE owns its removal
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/reject", headers=login_as(client, author)
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_reject_soft_deletes_detected(db, author):
    """Reject sets deleted_at (the row survives for a later re-import to
    recreate — recreate seam covered in test_detection.py), and the row drops
    off every public read."""
    geo = _detected(db, author)
    geo_id = geo.id
    response = client.post(
        f"/api/v1/geolocations/{geo_id}/reject", headers=login_as(client, author)
    )
    assert response.status_code == 204

    db.expire_all()
    row = db.query(Geolocation).filter(Geolocation.id == geo_id).one()
    assert row.deleted_at is not None
    # Gone from the public detail surface.
    assert client.get(f"/api/v1/geolocations/{geo_id}").status_code == 404


def test_reject_invalidates_points_cache(db, author):
    geo = _detected(db, author)
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "HIT"
    client.post(f"/api/v1/geolocations/{geo.id}/reject", headers=login_as(client, author))
    after = client.get("/api/v1/geolocations/points")
    assert after.headers.get("x-cache") == "MISS"
