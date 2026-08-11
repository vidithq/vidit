"""The list-endpoint pagination contract: the row cap, the cursor walk, the 422s.

Behavioural, not unit: each test drives the HTTP surface, because the contract
is what a caller observes (a page of at most 100 rows, a ``Link: rel="next"``
that walks the rest, a 422 for anything malformed) rather than how the query is
built. Shared fixtures live in ``conftest.py``; ``client`` / ``_make_geo`` in
``_helpers.py``.
"""

from __future__ import annotations

import re

from app.models.event import STATUS_DETECTED
from app.services.pagination import MAX_PAGE_SIZE
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client

_LIST = "/api/v1/events"
_DETECTIONS = "/api/v1/events/detections"


def _next_path(response) -> str | None:
    """The next-page path from a ``Link: <url>; rel="next"`` header, or None.

    Returned as a path so the walk feeds it straight back into the TestClient,
    which is what a caller following the header does.
    """
    header = response.headers.get("Link")
    if header is None:
        return None
    match = re.fullmatch(r'<(?P<url>[^>]+)>; rel="next"', header)
    assert match, f"malformed Link header: {header!r}"
    url = match.group("url")
    return url[url.index("/api/v1") :]


def _walk(first_path: str, headers: dict[str, str] | None = None) -> list[list[str]]:
    """Follow ``Link: rel="next"`` to exhaustion, returning each page's ids."""
    pages: list[list[str]] = []
    path: str | None = first_path
    while path is not None:
        response = client.get(path, headers=headers or {})
        assert response.status_code == 200
        body = response.json()
        rows = body["items"] if isinstance(body, dict) else body
        pages.append([row["id"] for row in rows])
        path = _next_path(response)
        # A cursor walk over a fixed set terminates; a bug that keeps handing
        # the same cursor back would otherwise hang the suite.
        assert len(pages) <= 50, "cursor walk did not terminate"
    return pages


# ── The cap ───────────────────────────────────────────────────────────────


def test_list_caps_at_100_however_many_are_asked_for(db, author):
    """Over-asking is not an error, it just does not buy more rows."""
    for _ in range(MAX_PAGE_SIZE + 5):
        _make_geo(db, author=author)

    response = client.get(f"{_LIST}?limit=500&author={author.username}")
    assert response.status_code == 200
    assert len(response.json()) == MAX_PAGE_SIZE


def test_detections_caps_at_100_however_many_are_asked_for(author):
    response = client.get(f"{_DETECTIONS}?per_page=500", headers=login_as(client, author))
    assert response.status_code == 200
    assert response.json()["per_page"] == MAX_PAGE_SIZE


# ── The cursor ────────────────────────────────────────────────────────────


def test_list_cursor_walks_the_whole_set_without_gaps_or_duplicates(db, author):
    created = {str(_make_geo(db, author=author).id) for _ in range(7)}

    pages = _walk(f"{_LIST}?limit=3&author={author.username}")

    assert [len(page) for page in pages] == [3, 3, 1]
    walked = [row_id for page in pages for row_id in page]
    assert len(walked) == len(set(walked)), "a row was served twice"
    assert set(walked) == created


def test_list_link_header_absent_on_the_last_page(db, author):
    for _ in range(2):
        _make_geo(db, author=author)

    response = client.get(f"{_LIST}?limit=50&author={author.username}")
    assert response.status_code == 200
    assert "Link" not in response.headers


def test_list_cursor_keeps_the_filters_it_was_minted_under(db, author, second_user):
    """The next-page URL carries the whole query, so a walk stays in one view."""
    mine = {str(_make_geo(db, author=author).id) for _ in range(3)}
    _make_geo(db, author=second_user)

    pages = _walk(f"{_LIST}?limit=2&author={author.username}")

    assert set(row_id for page in pages for row_id in page) == mine


def test_list_cursor_holds_across_a_row_landing_mid_walk(db, author):
    """The keyset walk is immune to the insert that shifts an OFFSET walk.

    A row inserted between two pages is newer than the cursor, so it belongs
    to a page already served: it must not push an unread row out of sight.
    """
    first_batch = [str(_make_geo(db, author=author).id) for _ in range(4)]

    page1 = client.get(f"{_LIST}?limit=2&author={author.username}")
    _make_geo(db, author=author)  # lands at the head of the ordering
    page2 = client.get(_next_path(page1))

    walked = [row["id"] for row in page1.json()] + [row["id"] for row in page2.json()]
    assert walked == list(reversed(first_batch)), "newest first, and the late row stays out"


def test_detections_cursor_walks_the_whole_queue(db, author):
    created = {
        str(
            _make_geo(
                db,
                author=author,
                status=STATUS_DETECTED,
                detected_from_url="https://x.com/a/status/1",
                source_url="https://x.com/a/status/1",
            ).id
        )
        for _ in range(5)
    }
    headers = login_as(client, author)

    pages = _walk(f"{_DETECTIONS}?per_page=2", headers=headers)

    assert [len(page) for page in pages] == [2, 2, 1]
    walked = [row_id for page in pages for row_id in page]
    assert len(walked) == len(set(walked))
    assert set(walked) == created


# ── Malformed input ───────────────────────────────────────────────────────


def test_list_rejects_malformed_paging_params(author):
    for query in ("limit=abc", "limit=0", "limit=-1", "limit=1.5"):
        response = client.get(f"{_LIST}?{query}")
        assert response.status_code == 422, f"expected 422 for {query!r}"


def test_list_rejects_a_cursor_it_did_not_mint(author):
    for cursor in ("garbage", "!!!", "e30", "W10", "MTIz", ""):
        response = client.get(f"{_LIST}?cursor={cursor}")
        assert response.status_code == 422, f"expected 422 for cursor={cursor!r}"


def test_detections_rejects_a_cursor_it_did_not_mint(author):
    response = client.get(f"{_DETECTIONS}?cursor=garbage", headers=login_as(client, author))
    assert response.status_code == 422


def test_user_events_rejects_a_page_below_one(author):
    """The negative ``OFFSET`` that Postgres answered with a 500."""
    for query in ("page=0", "page=-3", "per_page=0", "per_page=abc"):
        response = client.get(f"/api/v1/users/{author.username}/events?{query}")
        assert response.status_code == 422, f"expected 422 for {query!r}"


def test_user_events_caps_per_page_at_100(author):
    response = client.get(f"/api/v1/users/{author.username}/events?per_page=500")
    assert response.status_code == 200
    assert response.json()["per_page"] == MAX_PAGE_SIZE
