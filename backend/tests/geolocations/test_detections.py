"""The owner Detections queue: ``GET /geolocations/detections``.

Owner-scoped list of the caller's machine-``detected`` geolocations, paginated,
in full ``GeolocationRead`` shape (media + tags) so the queue renders the
evidence and computes submit-readiness client-side. Scoping is to
``current_user``, so the endpoint ignores any URL username. Shared fixtures live
in ``conftest.py``; ``client`` / ``_make_geo`` in ``_helpers.py``.
"""

from __future__ import annotations

from app.models.geolocation import STATE_DETECTED, STATE_SUBMITTED
from tests.conftest import login_as
from tests.geolocations._helpers import _make_geo, client

_URL = "/api/v1/geolocations/detections"


def _detected(db, author, **kwargs):
    """A machine ``detected`` row, born tagless unless ``tags`` is passed."""
    return _make_geo(
        db,
        author=author,
        state=STATE_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        source_url="https://x.com/a/status/1",
        **kwargs,
    )


def test_detections_requires_authentication(db, author):
    _detected(db, author)
    response = client.get(_URL)
    assert response.status_code == 401


def test_detections_empty_for_user_without_detections(author):
    response = client.get(_URL, headers=login_as(client, author))
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "per_page": 20}


def test_detections_returns_only_callers_live_detected(db, author, second_user):
    """Only the caller's live ``detected`` rows: not a submitted row, not a
    soft-deleted one, and not another analyst's detection; the endpoint scopes
    to ``current_user`` regardless of any URL username."""
    mine = _detected(db, author)
    _make_geo(db, author=author, state=STATE_SUBMITTED)  # submitted, excluded
    _detected(db, author, deleted=True)  # soft-deleted — excluded
    _detected(db, second_user)  # another analyst — excluded

    response = client.get(_URL, headers=login_as(client, author))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [str(mine.id)]
    assert body["items"][0]["state"] == "detected"


def test_detections_includes_media_and_tags(db, author, conflict_tag, capture_source_tag):
    """The queue needs media (to judge) and tags (to compute readiness) inline,
    plus the provenance link the card points back to."""
    _detected(db, author, tags=[conflict_tag, capture_source_tag], with_media=True)

    response = client.get(_URL, headers=login_as(client, author))
    item = response.json()["items"][0]
    assert len(item["media"]) == 1
    assert item["media"][0]["media_type"] == "image"
    assert {t["category"] for t in item["tags"]} == {"conflict", "capture_source"}
    assert item["detected_from_url"] == "https://x.com/a/status/1"


def test_detections_ordered_newest_first(db, author):
    older = _detected(db, author)
    newer = _detected(db, author)
    response = client.get(_URL, headers=login_as(client, author))
    assert [item["id"] for item in response.json()["items"]] == [str(newer.id), str(older.id)]


def test_detections_paginates(db, author):
    for _ in range(3):
        _detected(db, author)

    page1 = client.get(f"{_URL}?page=1&per_page=2", headers=login_as(client, author)).json()
    assert page1["total"] == 3
    assert page1["page"] == 1
    assert page1["per_page"] == 2
    assert len(page1["items"]) == 2

    page2 = client.get(f"{_URL}?page=2&per_page=2", headers=login_as(client, author)).json()
    assert len(page2["items"]) == 1
    # A row never straddles two pages.
    assert not ({i["id"] for i in page1["items"]} & {i["id"] for i in page2["items"]})


def test_detections_caps_per_page(author):
    """``per_page`` over the 100 cap is clamped, mirroring the per-user list."""
    response = client.get(f"{_URL}?per_page=500", headers=login_as(client, author))
    assert response.status_code == 200
    assert response.json()["per_page"] == 100


def test_detections_clamps_out_of_range_paging(author):
    """``page``/``per_page`` below 1 are clamped, not run as a negative OFFSET /
    non-positive LIMIT (which Postgres rejects with a 500)."""
    headers = login_as(client, author)
    page0 = client.get(f"{_URL}?page=0", headers=headers)
    assert page0.status_code == 200
    assert page0.json()["page"] == 1
    perpage0 = client.get(f"{_URL}?per_page=0", headers=headers)
    assert perpage0.status_code == 200
    assert perpage0.json()["per_page"] == 1
