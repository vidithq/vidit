"""`POST /events/import-from-tweet`: the paste creates a draft of your own post.

The route runs the shared engine and the shared write path, so what is pinned
here is the entry: the own-post check, the outcome payload, the re-import
upsert, and the error mapping. X is mocked at the transport (``httpx.Client``
swapped for a ``MockTransport`` factory), so the acquisition runs exactly where
production runs it. The grammar itself is pinned by ``tests/ingest_contract``.
Shared fixtures live in `conftest.py`; `client` in `_helpers.py`.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

from app.models.event import STATUS_DETECTED, Event
from app.services.tweet_ingest.syndication import _cache_clear
from tests.conftest import login_as
from tests.events._helpers import client

HANDLE = f"paste{uuid.uuid4().hex[:8]}"

COORD_ID = "1940000000000000001"
NO_COORD_ID = "1940000000000000002"
MULTI_COORD_ID = "1940000000000000003"
OTHER_AUTHOR_ID = "1940000000000000004"
TOMBSTONE_ID = "1940000000000000005"
BUSY_ID = "1940000000000000006"
DRIFT_ID = "1940000000000000007"

BODIES: dict[str, dict] = {
    COORD_ID: {
        "id_str": COORD_ID,
        "created_at": "2026-04-02T10:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "Strike on the depot\n48.123456, 37.654321",
    },
    NO_COORD_ID: {
        "id_str": NO_COORD_ID,
        "created_at": "2026-04-02T11:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "No coordinate here, just a thought",
    },
    MULTI_COORD_ID: {
        "id_str": MULTI_COORD_ID,
        "created_at": "2026-04-02T12:00:00.000Z",
        "user": {"screen_name": HANDLE},
        "text": "Two impacts\n48.123456, 37.654321\n49.223456, 38.754321",
    },
    OTHER_AUTHOR_ID: {
        "id_str": OTHER_AUTHOR_ID,
        "created_at": "2026-04-02T13:00:00.000Z",
        "user": {"screen_name": "someone_else"},
        "text": "Strike on the depot\n48.123456, 37.654321",
    },
}


def _url(tweet_id: str, handle: str = HANDLE) -> str:
    return f"https://x.com/{handle}/status/{tweet_id}"


@pytest.fixture(autouse=True)
def _mock_syndication(monkeypatch):
    """Serve the fixture bodies for every syndication fetch, 404 elsewhere.

    Returns the list of tweet ids the route actually asked X for, so a test can
    pin that a refusal happened before any budget was spent.
    """
    _cache_clear()
    asked: list[str] = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        tweet_id = request.url.params.get("id", "")
        asked.append(tweet_id)
        if tweet_id == TOMBSTONE_ID:
            return httpx.Response(200, json={"__typename": "TweetTombstone", "tombstone": {}})
        if tweet_id == BUSY_ID:
            return httpx.Response(429)
        if tweet_id == DRIFT_ID:
            return httpx.Response(200, json={})
        body = BODIES.get(tweet_id)
        return httpx.Response(200, json=body) if body is not None else httpx.Response(404)

    def make_client(**_kwargs):
        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "Client", make_client)
    yield asked
    _cache_clear()


@pytest.fixture
def linked_author(db, author):
    """The caller, with ``HANDLE`` linked as their X account."""
    author.x_handle = HANDLE
    db.commit()
    return author


def _post(user, tweet_id: str, handle: str = HANDLE):
    return client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, user),
        json={"url": _url(tweet_id, handle)},
    )


def _drafts(db, owner) -> list[Event]:
    db.expire_all()
    return db.query(Event).filter(Event.owner_id == owner.id).all()


def test_import_from_tweet_requires_auth():
    response = client.post(
        "/api/v1/events/import-from-tweet",
        json={"url": _url(COORD_ID)},
    )
    assert response.status_code == 401


def test_your_own_post_creates_a_draft(db, linked_author):
    response = _post(linked_author, COORD_ID)

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["created"]) == 1
    assert body["updated"] == [] and body["skipped"] == []
    assert body["reason"] is None and body["failed"] == 0

    [draft] = _drafts(db, linked_author)
    assert str(draft.id) == body["created"][0]
    assert draft.status == STATUS_DETECTED
    assert draft.detected_from_url == _url(COORD_ID)
    assert draft.title == "Strike on the depot"


def test_several_coordinates_land_several_drafts_and_a_warning(db, linked_author):
    response = _post(linked_author, MULTI_COORD_ID)

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["created"]) == 2
    # The engine's own vocabulary, surfaced verbatim so the page can name what
    # review has to answer: two drafts, and no source on either.
    assert body["warnings"] == ["several_coordinates", "source_missing"]
    assert len(_drafts(db, linked_author)) == 2


def test_a_post_with_no_coordinate_creates_nothing_and_names_why(db, linked_author):
    response = _post(linked_author, NO_COORD_ID)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == [] and body["reason"] == "coords_missing"
    assert _drafts(db, linked_author) == []


def test_pasting_the_same_post_twice_never_duplicates_the_draft(db, linked_author):
    first = _post(linked_author, COORD_ID)
    assert first.status_code == 200, first.text
    created = first.json()["created"]

    second = _post(linked_author, COORD_ID)

    assert second.status_code == 200, second.text
    body = second.json()
    # Nothing moved between the two passes, so the re-import leaves the draft
    # exactly as it stands and says so: one draft, never a duplicate.
    assert body["created"] == [] and body["skipped"] == created
    assert len(_drafts(db, linked_author)) == 1


def test_pasting_an_edited_post_overwrites_the_open_draft(db, linked_author, monkeypatch):
    first = _post(linked_author, COORD_ID)
    assert first.status_code == 200, first.text
    monkeypatch.setitem(BODIES[COORD_ID], "text", "Strike on the fuel depot\n48.123456, 37.654321")
    _cache_clear()  # else the hour-long fetch cache answers with the old body

    response = _post(linked_author, COORD_ID)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == [] and body["updated"] == first.json()["created"]
    [draft] = _drafts(db, linked_author)
    assert draft.title == "Strike on the fuel depot"


def test_someone_elses_post_is_refused(db, linked_author):
    response = _post(linked_author, OTHER_AUTHOR_ID, handle="someone_else")

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "not_your_post"
    # Names both handles, so an accidental colleague-URL paste self-corrects.
    assert "@someone_else" in detail["message"] and f"@{HANDLE}" in detail["message"]
    assert _drafts(db, linked_author) == []


def test_an_account_with_no_linked_handle_is_refused_before_the_fetch(author, _mock_syndication):
    response = _post(author, COORD_ID)

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "not_your_post"
    # No syndication call: an unlinked caller never spends the shared budget.
    assert _mock_syndication == []


def test_a_url_that_names_no_post_is_a_400(linked_author):
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, linked_author),
        json={"url": "https://example.com"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_tweet_url"


def test_a_post_x_will_not_serve_is_a_404(linked_author):
    """A post readable only behind an X login answers a ``TweetTombstone``
    body: a 404 the analyst can act on, not a 502 that pages an operator."""
    response = _post(linked_author, TOMBSTONE_ID)

    assert response.status_code == 404, response.text
    assert response.json()["detail"]["code"] == "post_not_accessible"


def test_a_throttled_upstream_is_a_503(linked_author):
    response = _post(linked_author, BUSY_ID)

    assert response.status_code == 503, response.text
    assert response.json()["detail"]["code"] == "upstream_busy"


def test_an_unusable_upstream_body_is_a_502(linked_author):
    """An exactly-empty ``{}`` body is X rejecting the locally computed token,
    so import is down for everyone: a 502 an operator is alerted on."""
    response = _post(linked_author, DRIFT_ID)

    assert response.status_code == 502, response.text
    assert response.json()["detail"]["code"] == "upstream_unreadable"
