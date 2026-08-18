"""The owner Detections queue: ``GET /geolocations/detections``.

Owner-scoped list of the caller's machine-``detected`` geolocations, paginated,
in full ``EventRead`` shape (media + tags) so the queue renders the evidence.
Scoping is to ``current_user``, so the endpoint ignores any URL username. The
``readiness`` filter, its counts and its pagination are here too; the rule it
filters on is held to the publish floor by ``test_detections_readiness.py``.
Shared fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` in
``_helpers.py``.
"""

from __future__ import annotations

from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client
from tests.events._readiness_cases import (
    INCOMPLETE_CASE_NAMES,
    READINESS_CASES,
    READY_CASE_NAMES,
)

_URL = "/api/v1/events/detections"


def _detected(db, author, **kwargs):
    """A machine ``detected`` row, born tagless unless ``tags`` is passed."""
    kwargs.setdefault("source_url", "https://x.com/a/status/1")
    return _make_geo(
        db,
        author=author,
        status=STATUS_DETECTED,
        detected_from_url="https://x.com/a/status/1",
        **kwargs,
    )


def _mixed_queue(db, author) -> dict[str, str]:
    """One detection per shape in the shared table; returns name -> event id."""
    return {
        name: str(_detected(db, author, **dict(overrides)).id)
        for name, (overrides, _) in READINESS_CASES.items()
    }


def test_detections_requires_authentication(db, author):
    _detected(db, author)
    response = client.get(_URL)
    assert response.status_code == 401


def test_detections_empty_for_user_without_detections(author):
    response = client.get(_URL, headers=login_as(client, author))
    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "per_page": 20,
        "ready_total": 0,
        "incomplete_total": 0,
    }


def test_detections_returns_only_callers_live_detected(db, author, second_user):
    """Only the caller's live ``detected`` rows: not a geolocated row, not a
    soft-deleted one, and not another analyst's detection; the endpoint scopes
    to ``current_user`` regardless of any URL username."""
    mine = _detected(db, author)
    _make_geo(db, author=author, status=STATUS_GEOLOCATED)  # geolocated, excluded
    _detected(db, author, deleted=True)  # soft-deleted — excluded
    _detected(db, second_user)  # another analyst — excluded

    response = client.get(_URL, headers=login_as(client, author))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [str(mine.id)]
    assert body["items"][0]["status"] == "detected"


def test_detections_includes_media_and_tags(db, author, conflict, capture_source_tag):
    """The queue needs media (to judge) and tags (to compute readiness) inline,
    plus the provenance link the card points back to."""
    _detected(db, author, tags=[capture_source_tag], conflicts=[conflict], with_media=True)

    response = client.get(_URL, headers=login_as(client, author))
    item = response.json()["items"][0]
    assert len(item["media"]) == 1
    assert item["media"][0]["media_type"] == "image"
    assert {t["category"] for t in item["tags"]} == {"capture_source"}
    assert [c["name"] for c in item["conflicts"]] == [conflict.name]
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


def test_detections_rejects_out_of_range_paging(author):
    """``page``/``per_page`` below 1 are 422, not run as a negative OFFSET /
    non-positive LIMIT (which Postgres rejects with a 500)."""
    headers = login_as(client, author)
    assert client.get(f"{_URL}?page=0", headers=headers).status_code == 422
    assert client.get(f"{_URL}?per_page=0", headers=headers).status_code == 422
    assert client.get(f"{_URL}?per_page=-5", headers=headers).status_code == 422
    assert client.get(f"{_URL}?page=abc", headers=headers).status_code == 422


# ── readiness filter ──────────────────────────────────────────────────────


def test_detections_readiness_selects_over_the_whole_queue(db, author):
    """``ready`` pages through ready detections only, ``incomplete`` through the
    rest, and ``all`` (the default) through both.

    The bug this replaces: the queue filtered the loaded page client-side while
    paging server-side, so an analyst on a page of ten incomplete rows read
    "no ready detections" and concluded their whole import carried no evidence.
    """
    ids = _mixed_queue(db, author)
    headers = login_as(client, author)

    ready = client.get(f"{_URL}?readiness=ready&per_page=100", headers=headers).json()
    assert {item["id"] for item in ready["items"]} == {ids[n] for n in READY_CASE_NAMES}

    incomplete = client.get(f"{_URL}?readiness=incomplete&per_page=100", headers=headers).json()
    assert {item["id"] for item in incomplete["items"]} == {ids[n] for n in INCOMPLETE_CASE_NAMES}

    every = client.get(f"{_URL}?per_page=100", headers=headers).json()
    assert {item["id"] for item in every["items"]} == set(ids.values())


def test_detections_total_counts_the_filtered_set(db, author):
    """``total`` describes what is being paged, so the page count the queue
    renders is the filtered one."""
    _mixed_queue(db, author)
    headers = login_as(client, author)

    assert client.get(f"{_URL}?readiness=ready", headers=headers).json()["total"] == len(
        READY_CASE_NAMES
    )
    assert client.get(f"{_URL}?readiness=incomplete", headers=headers).json()["total"] == len(
        INCOMPLETE_CASE_NAMES
    )
    assert client.get(_URL, headers=headers).json()["total"] == len(READINESS_CASES)


def test_detections_carries_both_counts_under_every_filter(db, author):
    """``ready_total`` / ``incomplete_total`` describe the whole queue whatever
    ``readiness`` asks for: the analyst reads both figures without paging and
    without a second call."""
    _mixed_queue(db, author)
    headers = login_as(client, author)

    for readiness in ("all", "ready", "incomplete"):
        body = client.get(f"{_URL}?readiness={readiness}&per_page=1", headers=headers).json()
        assert body["ready_total"] == len(READY_CASE_NAMES)
        assert body["incomplete_total"] == len(INCOMPLETE_CASE_NAMES)
        assert body["ready_total"] + body["incomplete_total"] == len(READINESS_CASES)


def test_detections_pages_within_the_filtered_set(db, author):
    """Paging under a filter walks the filtered rows, and only those.

    The pages partition the filtered set: no row is served twice, none is
    skipped, and a page never leaks a row the filter excluded.
    """
    ids = _mixed_queue(db, author)
    headers = login_as(client, author)
    expected = {ids[name] for name in INCOMPLETE_CASE_NAMES}

    walked: list[str] = []
    for page in (1, 2, 3, 4):
        body = client.get(
            f"{_URL}?readiness=incomplete&page={page}&per_page=2", headers=headers
        ).json()
        assert body["total"] == len(expected)
        walked.extend(item["id"] for item in body["items"])

    assert len(walked) == len(expected)
    assert set(walked) == expected


def test_detections_readiness_rejects_an_unknown_value(author):
    """An unknown ``readiness`` is a 422, as an unknown ``view`` is on
    ``GET /events``: a typo must not silently serve the unfiltered queue."""
    headers = login_as(client, author)
    response = client.get(f"{_URL}?readiness=complete", headers=headers)
    assert response.status_code == 422
    assert "readiness must be one of" in response.json()["detail"]
    assert client.get(f"{_URL}?readiness=", headers=headers).status_code == 422
