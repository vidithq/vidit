"""Acquisition: quoted sub-record, source-link classification, and the one hop.

Tests over canned syndication bodies (no network, a ``MockTransport``): the
inline quoted tweet must resolve to a full sub-record (id, handle, date,
media), ``entities.urls`` must classify by host so a consumer can tell a
chaseable X source from off-platform Telegram / YouTube, and ``acquire_thread``
must read the post plus its same-author parent and nothing further.
"""

import httpx
import pytest

from app.services.tweet_ingest import TweetNotAccessible, acquire_thread
from app.services.tweet_ingest.acquire import _quoted_record
from app.services.tweet_ingest.syndication import (
    _cache_clear,
    classify_source_host,
    extract_media_shortlinks,
    extract_source_links,
)


def test_classify_source_host():
    assert classify_source_host("https://x.com/a/status/1") == "x"
    assert classify_source_host("https://twitter.com/a/status/1") == "x"
    assert classify_source_host("https://x.com/i/web/status/1") == "x"
    assert classify_source_host("https://t.me/chan/42") == "telegram"
    assert classify_source_host("https://youtu.be/xyz") == "youtube"
    assert classify_source_host("https://www.youtube.com/watch?v=x") == "youtube"
    assert classify_source_host("https://example.org/x") == "other"


def test_classify_source_host_profile_link_is_not_footage():
    # A bare profile link (no /status/) is not footage, unlike a status link.
    assert classify_source_host("https://x.com/a") == "other"
    assert classify_source_host("https://twitter.com/a/") == "other"


def test_extract_source_links_classifies_dedupes_skips_tco():
    body = {
        "entities": {
            "urls": [
                {"url": "https://t.co/aaa", "expanded_url": "https://t.me/foo/123"},
                {"url": "https://t.co/bbb", "expanded_url": "https://x.com/bar/status/456"},
                {"url": "https://t.co/ccc", "expanded_url": "https://t.me/foo/123"},  # duplicate
                {"expanded_url": "https://t.co/wrapped"},  # skipped (wrapper)
                {"expanded_url": "https://youtu.be/xyz"},  # no wrapper token supplied
            ]
        }
    }
    assert extract_source_links(body) == [
        ("https://t.me/foo/123", "telegram", "https://t.co/aaa"),
        ("https://x.com/bar/status/456", "x", "https://t.co/bbb"),
        ("https://youtu.be/xyz", "youtube", None),
    ]


def test_extract_source_links_profile_link_is_not_footage():
    # Regression: entities.urls carries the profile link before the status
    # link, the order X returns them in for a tweet linking its own author's
    # profile page then the actual status. The profile classifies as "other";
    # the status link still classifies as "x".
    body = {
        "entities": {
            "urls": [
                {"expanded_url": "https://x.com/Osinttechnical"},
                {"expanded_url": "https://x.com/Osinttechnical/status/2028478401154084878"},
            ]
        }
    }
    assert extract_source_links(body) == [
        ("https://x.com/Osinttechnical", "other", None),
        ("https://x.com/Osinttechnical/status/2028478401154084878", "x", None),
    ]


def test_extract_source_links_empty_without_entities():
    assert extract_source_links({}) == []


def test_extract_media_shortlinks_reads_both_payload_shapes():
    # The export names the wrappers under extended_entities / entities.media,
    # a syndication body under mediaDetails. One wrapper is shared by a
    # multi-photo post, so the list de-dupes and keeps order.
    export = {
        "entities": {"media": [{"type": "photo", "url": "https://t.co/own"}]},
        "extended_entities": {
            "media": [
                {"type": "photo", "url": "https://t.co/own"},
                {"type": "photo", "url": "https://t.co/own"},
            ]
        },
    }
    assert extract_media_shortlinks(export) == ["https://t.co/own"]

    body = {"mediaDetails": [{"type": "video", "url": "https://t.co/clip"}, {"type": "photo"}]}
    assert extract_media_shortlinks(body) == ["https://t.co/clip"]


def test_extract_media_shortlinks_empty_without_media():
    # A link-only post declares no wrapper, so no token is ever dropped from a
    # designation line by accident.
    assert extract_media_shortlinks({"entities": {"urls": [{"url": "https://t.co/a"}]}}) == []


def test_quoted_record_carries_date_and_media():
    body = {
        "quoted_tweet": {
            "id_str": "111",
            "created_at": "2025-06-07T07:27:30.000Z",
            "user": {"screen_name": "dom"},
            "text": "footage here",
            "mediaDetails": [
                {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/x.jpg"}
            ],
        }
    }
    quoted = _quoted_record(body)
    assert quoted is not None
    assert quoted.tweet_id == "111"
    assert quoted.handle == "dom"
    assert quoted.created_at.startswith("2025-06-07")
    assert len(quoted.media) == 1
    assert quoted.media[0].kind == "image"
    assert quoted.media[0].origin == "quote"


def test_quoted_record_none_without_quote():
    assert _quoted_record({"text": "no quote here"}) is None


# ── acquire_thread: the one hop the bot and the paste share ───────────────


_POST_ID = "9400000000000000301"
_PARENT_ID = "9400000000000000302"


def _body(tweet_id: str, *, handle: str, text: str, reply_to: str | None = None) -> dict:
    body: dict = {
        "id_str": tweet_id,
        "created_at": "2026-03-11T12:00:00.000Z",
        "user": {"screen_name": handle},
        "text": text,
    }
    if reply_to is not None:
        body["in_reply_to_status_id_str"] = reply_to
    return body


def _client(bodies: dict[str, dict], seen: list[str] | None = None) -> httpx.Client:
    """A syndication transport serving ``bodies`` by tweet id, 404 elsewhere."""

    def handler(req: httpx.Request) -> httpx.Response:
        tweet_id = req.url.params.get("id", "")
        if seen is not None:
            seen.append(tweet_id)
        body = bodies.get(tweet_id)
        return httpx.Response(200, json=body) if body is not None else httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _clear_syndication_cache():
    # ``fetch_syndication`` caches by tweet id process-wide, so one test's
    # body would otherwise answer the next test's fetch of the same id.
    _cache_clear()
    yield
    _cache_clear()


def test_acquire_thread_joins_the_same_authors_parent():
    bodies = {
        _POST_ID: _body(_POST_ID, handle="analyst", text="Source: here", reply_to=_PARENT_ID),
        _PARENT_ID: _body(_PARENT_ID, handle="analyst", text="48.123456, 37.654321"),
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    # Parent first: the head anchors the provenance and the event date.
    assert [r.tweet_id for r in acquired.records] == [_PARENT_ID, _POST_ID]
    assert acquired.post.tweet_id == _POST_ID
    assert acquired.parent is not None
    assert acquired.parent.permalink == f"https://x.com/analyst/status/{_PARENT_ID}"
    assert acquired.post.permalink == f"https://x.com/analyst/status/{_POST_ID}"


def test_acquire_thread_case_folds_the_parent_permalink():
    # The parent's permalink is the key its own import would land on, so it is
    # folded whatever case the caller spelled the post's author in.
    bodies = {
        _POST_ID: _body(_POST_ID, handle="Analyst", text="reply", reply_to=_PARENT_ID),
        _PARENT_ID: _body(_PARENT_ID, handle="Analyst", text="48.123456, 37.654321"),
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="Analyst", client=client)
    assert acquired.parent is not None
    assert acquired.parent.permalink == f"https://x.com/analyst/status/{_PARENT_ID}"


def test_acquire_thread_reads_one_hop_only():
    grandparent = "9400000000000000303"
    bodies = {
        _POST_ID: _body(_POST_ID, handle="analyst", text="third", reply_to=_PARENT_ID),
        _PARENT_ID: _body(_PARENT_ID, handle="analyst", text="second", reply_to=grandparent),
        grandparent: _body(grandparent, handle="analyst", text="first"),
    }
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_PARENT_ID, _POST_ID]
    assert seen == [_POST_ID, _PARENT_ID]


def test_acquire_thread_fetches_nothing_for_a_non_reply():
    bodies = {_POST_ID: _body(_POST_ID, handle="analyst", text="standalone")}
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.parent is None
    assert acquired.records == [acquired.post]
    assert seen == [_POST_ID]


def test_acquire_thread_drops_another_authors_parent():
    # The guard runs on the FETCHED handle: the parent's URL is built from the
    # post's author, but syndication returns whoever really wrote it.
    bodies = {
        _POST_ID: _body(_POST_ID, handle="analyst", text="tagging this", reply_to=_PARENT_ID),
        _PARENT_ID: _body(_PARENT_ID, handle="someone_else", text="48.123456, 37.654321"),
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.parent is None
    assert acquired.records == [acquired.post]


def test_acquire_thread_unreadable_parent_degrades_to_the_post_alone():
    # The parent was deleted or is protected: the post still resolves alone.
    bodies = {_POST_ID: _body(_POST_ID, handle="analyst", text="reply", reply_to=_PARENT_ID)}
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.parent is None
    assert acquired.records == [acquired.post]


def test_acquire_thread_raises_when_the_post_itself_is_unreadable():
    with _client({}) as client, pytest.raises(TweetNotAccessible):
        acquire_thread(_POST_ID, handle="analyst", client=client)
