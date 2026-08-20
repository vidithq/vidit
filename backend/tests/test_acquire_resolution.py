"""Acquisition: link extraction, the one hop, the bare-tag climb, the chase.

Tests over canned syndication bodies (no network, a ``MockTransport``):
``entities.urls`` must reach the record as expanded URLs bound to their
wrappers, ``acquire_thread`` must read a contentful post plus its same-author
parent and nothing further, a bare tag must climb its author's parents to the
coordinate post, and the thread's sole source candidate must be chased. What the
acquired thread then resolves to is pinned by ``tests/ingest_contract``.
"""

import httpx
import pytest

from app.services.tweet_ingest import TweetNotAccessible, acquire_thread, resolve_threads
from app.services.tweet_ingest.syndication import (
    _cache_clear,
    extract_source_links,
)


def test_extract_source_links_expands_dedupes_skips_tco():
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
        ("https://t.me/foo/123", "https://t.co/aaa"),
        ("https://x.com/bar/status/456", "https://t.co/bbb"),
        ("https://youtu.be/xyz", None),
    ]


def test_extract_source_links_empty_without_entities():
    assert extract_source_links({}) == []


# ── acquire_thread: the one hop the bot and the paste share ───────────────


_POST_ID = "1940000000000000301"
_PARENT_ID = "1940000000000000302"


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


def test_acquire_thread_joins_the_parent_whatever_case_the_caller_spelled():
    # The caller's spelling of the handle is a fallback, never the identity: the
    # same-author guard runs on the screen names X answered with.
    bodies = {
        _POST_ID: _body(_POST_ID, handle="Analyst", text="reply", reply_to=_PARENT_ID),
        _PARENT_ID: _body(_PARENT_ID, handle="Analyst", text="48.123456, 37.654321"),
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_PARENT_ID, _POST_ID]


def test_acquire_thread_reads_one_hop_only():
    grandparent = "1940000000000000303"
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
    assert acquired.records == [acquired.post]


def test_acquire_thread_unreadable_parent_degrades_to_the_post_alone():
    # The parent was deleted or is protected: the post still resolves alone.
    bodies = {_POST_ID: _body(_POST_ID, handle="analyst", text="reply", reply_to=_PARENT_ID)}
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.records == [acquired.post]


def test_acquire_thread_raises_when_the_post_itself_is_unreadable():
    with _client({}) as client, pytest.raises(TweetNotAccessible):
        acquire_thread(_POST_ID, handle="analyst", client=client)


# ── The bare tag: a pointer at the thread above it ────────────────────────
#
# The field shape: the analyst posts the coordinate (and the footage above it),
# replies to themselves with the source, then drops a bare ``@ViditBot`` under
# the last post of their own thread. The tag itself says nothing, so it
# re-anchors on the coordinate rather than reading one hop and refusing.

_CLIMB_IDS = [f"19400000000000005{n:02d}" for n in range(6)]
_COORD_TEXT = "POV: 57.567596, 39.935483"


def _chain(*, texts: list[str], handle: str = "analyst") -> dict[str, dict]:
    """Bodies for a reply chain, ``texts[0]`` the post the caller is pointed at
    and each next text its parent, so the last one is the thread head."""
    bodies: dict[str, dict] = {}
    for index, text in enumerate(texts):
        parent = _CLIMB_IDS[index + 1] if index + 1 < len(texts) else None
        bodies[_CLIMB_IDS[index]] = _body(
            _CLIMB_IDS[index], handle=handle, text=text, reply_to=parent
        )
    return bodies


def test_a_bare_tag_climbs_past_the_source_reply_to_the_coordinate_post():
    # The reproduced case: the tag replies to a "Source:" post, which replies to
    # the post carrying the coordinate and the media.
    bodies = _chain(texts=["@viditbot", "Source: https://example.org/clip", _COORD_TEXT])
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[2], _CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1], _CLIMB_IDS[2]]

    [detection] = resolve_threads([acquired.records]).detections
    assert detection.coordinate.lat == pytest.approx(57.567596)
    assert detection.coordinate.lng == pytest.approx(39.935483)


def test_the_climb_stops_on_the_coordinate_post_and_reads_one_post_above_it():
    # The numbered shape: footage in the head, the coordinate in the reply under
    # it. The post above the coordinate is read so its media reaches the
    # resolution; the one above that is not.
    bodies = _chain(
        texts=[
            "@viditbot",
            f"2 | 2 {_COORD_TEXT}",
            "1 | 2 footage",
            "unrelated earlier post",
        ]
    )
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[2], _CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1], _CLIMB_IDS[2]]


def test_a_bare_tag_with_no_coordinate_stops_at_the_cap_and_still_refuses():
    # The cap bounds what one pointer costs: three parent fetches beyond the
    # tag, whatever the thread's depth. What was climbed is kept, so the refusal
    # is the analyst's own text, not the limit.
    bodies = _chain(texts=["@viditbot", "one", "two", "three", "four", _COORD_TEXT])
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert seen == _CLIMB_IDS[:4]
    assert [r.tweet_id for r in acquired.records] == list(reversed(_CLIMB_IDS[:4]))
    assert resolve_threads([acquired.records]).reason == "coords_missing"


def test_a_bare_tag_under_another_authors_post_acquires_the_tag_alone():
    # The same-author guard ends the climb, which is also the loop guard: a
    # courtesy bare tag under the bot's own reply climbs nothing.
    bodies = _chain(texts=["@viditbot", _COORD_TEXT])
    bodies[_CLIMB_IDS[1]]["user"] = {"screen_name": "someone_else"}
    with _client(bodies) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert acquired.records == [acquired.post]


def test_a_tag_carrying_text_of_its_own_reads_one_hop_only():
    # Content beside the tag is content, and content is read where it sits.
    bodies = _chain(texts=["@viditbot geolocated below", "one", _COORD_TEXT])
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1]]


def test_a_tag_carrying_media_reads_one_hop_only():
    bodies = _chain(texts=["@viditbot", "one", _COORD_TEXT])
    bodies[_CLIMB_IDS[0]]["mediaDetails"] = [
        {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/x.jpg"}
    ]
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1]]


# ── The chase: the thread's sole source candidate, at most one fetch ───────


_CHASED_ID = "1940000000000000401"
_TG_URL = "https://t.me/somechannel/12345"


def _linking_body(url: str, *, wrapper: str = "https://t.co/fakeLINK") -> dict:
    body = _body(_POST_ID, handle="analyst", text=f"Geolocated 48.012345, 37.802411\n{wrapper}")
    body["entities"] = {"urls": [{"url": wrapper, "expanded_url": url}]}
    return body


def test_the_sole_x_status_candidate_is_chased_into_the_quote_slot():
    chased = _body(_CHASED_ID, handle="front_cam", text="raw footage")
    chased["mediaDetails"] = [
        {
            "type": "video",
            "video_info": {
                "variants": [
                    {
                        "bitrate": 2176000,
                        "content_type": "video/mp4",
                        "url": "https://video.twimg.com/v.mp4",
                    }
                ]
            },
        }
    ]
    bodies = {
        _POST_ID: _linking_body(f"https://x.com/front_cam/status/{_CHASED_ID}"),
        _CHASED_ID: chased,
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    [record] = acquired.records
    assert record.quoted is not None
    assert record.quoted.tweet_id == _CHASED_ID
    assert [m.kind for m in record.quoted.media] == ["video"]


def test_a_chase_that_404s_degrades_to_link_only():
    bodies = {_POST_ID: _linking_body(f"https://x.com/front_cam/status/{_CHASED_ID}")}
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    [record] = acquired.records
    assert record.quoted is None
    assert record.telegram is None


def test_a_chased_status_that_turns_out_to_be_the_analysts_own_is_dropped():
    # The handle-less ``i/web`` form slips the URL-level own-handle skip; the
    # chased screen name reveals the self-reference.
    bodies = {
        _POST_ID: _linking_body(f"https://x.com/i/web/status/{_CHASED_ID}"),
        _CHASED_ID: _body(_CHASED_ID, handle="analyst", text="my earlier post"),
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.records[0].quoted is None


def test_the_sole_telegram_candidate_is_chased_into_the_telegram_slot(monkeypatch):
    import app.services.tweet_ingest.chase.telegram as telegram_mod
    from app.services.tweet_ingest.records import ChasedPost, ChaseResult

    def fake_chase(target: str, *, client=None) -> ChaseResult:
        assert target == _TG_URL
        return ChaseResult(
            outcome="chased",
            post=ChasedPost(url=target, posted_at="2026-03-04T09:00:00+00:00"),
        )

    monkeypatch.setattr(telegram_mod, "chase", fake_chase)
    with _client({_POST_ID: _linking_body(_TG_URL)}) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    [record] = acquired.records
    assert record.telegram is not None
    assert record.telegram.posted_at == "2026-03-04T09:00:00+00:00"


@pytest.mark.parametrize(
    "outcome,expected",
    [("transient_failure", True), ("not_accessible", False), ("no_target", False)],
)
def test_a_chase_that_found_nothing_reports_its_class_to_the_resolution(
    monkeypatch, outcome, expected
):
    """The chase is fail-soft, so a failure never reaches the analyst as an
    error. The class of it still travels, on the record that declared the
    target: only a transient one is worth importing again later, and the
    resolution is what turns that into the detection's warning."""
    import app.services.tweet_ingest.chase.telegram as telegram_mod
    from app.services.tweet_ingest.records import ChaseResult

    monkeypatch.setattr(
        telegram_mod, "chase", lambda target, *, client=None: ChaseResult(outcome=outcome)
    )
    with _client({_POST_ID: _linking_body(_TG_URL)}) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    [record] = acquired.records
    assert record.telegram is None
    assert (record.chase_outcome == "transient_failure") is expected

    [detection] = resolve_threads([acquired.records]).detections
    assert detection.source_url == _TG_URL
    assert detection.source_fetch_failed is expected


def test_nothing_is_chased_when_the_candidates_are_ambiguous(monkeypatch):
    import app.services.tweet_ingest.chase.telegram as telegram_mod

    def fail(*args, **kwargs):
        raise AssertionError("an ambiguous thread must not chase")

    monkeypatch.setattr(telegram_mod, "chase", fail)
    body = _linking_body(_TG_URL)
    body["entities"]["urls"].append(
        {"url": "https://t.co/second", "expanded_url": "https://youtu.be/xyz"}
    )
    with _client({_POST_ID: body}) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.records[0].telegram is None


def test_an_off_vocabulary_candidate_is_not_chased():
    # A TikTok / article link is a valid source, stored link-only: no fetch.
    seen: list[str] = []
    bodies = {_POST_ID: _linking_body("https://www.tiktok.com/@war/video/7")}
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_POST_ID, handle="analyst", client=client)
    assert acquired.records[0].quoted is None
    assert seen == [_POST_ID]
