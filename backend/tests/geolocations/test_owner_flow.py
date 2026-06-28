"""Owner mutation lifecycle for `/geolocations`.

`DELETE` (hard delete, author-only) plus the machine-`detected` owner flow:
`POST .../submit` (writes the owner's edits and flips the row to `submitted`)
and `POST .../reject` (soft-delete, re-importable). Both state-gated to
`detected`. Shared fixtures live in `conftest.py`; `client` / `_make_geo` in
`_helpers.py`.
"""

from __future__ import annotations

import json
import uuid

from app.models.geolocation import STATUS_DETECTED, STATUS_SUBMITTED, Geolocation
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


# ── Owner flow: POST .../submit / POST .../reject ──────────────────────────
# Both owner-only and state-gated to ``detected``; a ``submitted`` row is frozen.
# A ``detected`` row is immutable machine output: submit writes the owner's edits
# AND flips it to ``submitted`` in one step (the create-time evidence floor is
# enforced there). The detected → submitted freeze and the soft-delete-then-
# re-import recreate seam (test_detection.py::
# test_idempotency_recreates_soft_deleted_pair) are what these lock in.


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


# ── POST /geolocations/{id}/submit: write the form + freeze (detected → submitted) ──


def _submit_form(**overrides):
    """A complete submit form (it posts the whole state, like create). Override
    per test; ``tag_ids`` / ``remove_media_ids`` are JSON. Carries no tags by
    default, so a bare submit fails the floor unless ``_floor_form`` is used."""
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


def _floor_form(conflict_tag, capture_source_tag, **overrides):
    """A submit form that meets the tag floor (both curated tags). Pair with a
    ``with_media=True`` row to clear the whole floor."""
    return _submit_form(
        tag_ids=json.dumps([str(conflict_tag.id), str(capture_source_tag.id)]),
        **overrides,
    )


def test_submit_requires_authentication(db, author):
    geo = _detected(db, author)
    response = client.post(f"/api/v1/geolocations/{geo.id}/submit", data=_submit_form())
    assert response.status_code == 401


def test_submit_returns_404_for_unknown_id(author):
    response = client.post(
        f"/api/v1/geolocations/{uuid.uuid4()}/submit",
        data=_submit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_submit_returns_404_for_soft_deleted(db, author):
    geo = _detected(db, author, deleted=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 404


def test_submit_returns_403_when_not_author(db, author, second_user):
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(),
        headers=login_as(client, second_user),
    )
    assert response.status_code == 403


def test_submit_rejects_submitted_row(db, author):
    """A ``submitted`` row is frozen, submit 409s with the invalid_state code."""
    geo = _make_geo(db, author=author)  # default state = submitted
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(),
        headers=login_as(client, author),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"


def test_submit_writes_fields_and_freezes(db, author, conflict_tag, capture_source_tag):
    """Submit writes the whole form and flips the row to ``submitted``."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(
            conflict_tag,
            capture_source_tag,
            title="Completed title",
            lat="50.25",
            lng="30.5",
            event_date="2026-07-01",
            source_posted_at="2026-06-30T07:45",
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
    # Submit freezes it: a detected row becomes submitted.
    assert body["status"] == "submitted"

    db.expire_all()
    refreshed = db.query(Geolocation).filter(Geolocation.id == geo.id).one()
    assert refreshed.title == "Completed title"
    assert refreshed.status == STATUS_SUBMITTED


def test_submit_applies_source_url_but_ignores_provenance_and_state(
    db, author, conflict_tag, capture_source_tag
):
    """The owner curates the form: ``source_url`` is editable. Only
    ``detected_from_url`` (provenance) and ``state`` have no field, so sending
    them is silently ignored. The row ends ``submitted`` via the submit itself."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(
            conflict_tag,
            capture_source_tag,
            source_url="https://example.com/new-source",
            detected_from_url="https://evil.example/swap",  # ignored, no field
            status="detected",  # ignored, no field
        ),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_url"] == "https://example.com/new-source"  # editable
    assert body["detected_from_url"] == "https://x.com/a/status/1"  # immutable
    assert body["status"] == "submitted"  # set by submit, not the ignored field


def test_submit_source_posted_at_round_trips(db, author, conflict_tag, capture_source_tag):
    """source_posted_at is part of the full form and round-trips; it's required
    (a post always has a time)."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(conflict_tag, capture_source_tag, source_posted_at="2026-06-30T13:20"),
        headers=login_as(client, author),
    )
    assert response.status_code == 200
    assert response.json()["source_posted_at"].startswith("2026-06-30T13:20")


def test_submit_rejects_out_of_range_coordinate(db, author):
    """Coordinate validation runs before the floor, so a bad coord 400s even on a
    bare form."""
    geo = _detected(db, author)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(lat="200.0"),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_coordinates"


def test_submit_blocked_without_media(db, author, conflict_tag, capture_source_tag):
    """The evidence floor is enforced at submit: no media (kept + new) 400s."""
    geo = _detected(db, author, with_media=False)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(conflict_tag, capture_source_tag),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "media_required"


def test_submit_blocked_without_required_tags(db, author):
    """A detected row is born tagless; submit enforces the conflict +
    capture_source floor the create path skips for machine rows."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(),  # no tag_ids
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_submit_blocked_with_partial_tags(db, author, conflict_tag):
    """conflict alone isn't enough; capture_source is still required."""
    geo = _detected(db, author, with_media=True)
    response = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_submit_form(tag_ids=json.dumps([str(conflict_tag.id)])),
        headers=login_as(client, author),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "tag_requirements_not_met"


def test_submit_freezes_against_resubmit(db, author, conflict_tag, capture_source_tag):
    """After submit the row is ``submitted``; a follow-up submit 409s."""
    geo = _detected(db, author, with_media=True)
    ok = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(conflict_tag, capture_source_tag),
        headers=login_as(client, author),
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "submitted"

    frozen = client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(conflict_tag, capture_source_tag),
        headers=login_as(client, author),
    )
    assert frozen.status_code == 409
    assert frozen.json()["detail"]["code"] == "invalid_state"


def test_submit_invalidates_points_cache(db, author, conflict_tag, capture_source_tag):
    geo = _detected(db, author, with_media=True)
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "HIT"
    client.post(
        f"/api/v1/geolocations/{geo.id}/submit",
        data=_floor_form(conflict_tag, capture_source_tag),
        headers=login_as(client, author),
    )
    assert client.get("/api/v1/geolocations/points").headers.get("x-cache") == "MISS"


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


def test_reject_rejects_submitted_row(db, author):
    geo = _make_geo(db, author=author)  # submitted, DELETE owns its removal
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
