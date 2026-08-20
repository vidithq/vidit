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

import app.services.tweet_ingest.chase.telegram as telegram_mod
from app.services.tweet_ingest import TweetNotAccessible, acquire_thread, resolve_threads
from app.services.tweet_ingest.records import ChasedPost, ChaseResult
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
_EARLIER_COORD_TEXT = "Earlier: 48.012345, 37.802411"


def _photo() -> list[dict]:
    """One photo entry, the syndication shape ``extract_media`` reads."""
    return [{"type": "photo", "media_url_https": "https://pbs.twimg.com/media/x.jpg"}]


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


def test_the_climb_joins_the_footage_post_above_the_coordinate_post():
    # The numbered shape: footage in the head, the coordinate in the reply under
    # it. The post above the coordinate carries the media the coordinate post
    # lacks, so it joins; the one above that is not read.
    bodies = _chain(
        texts=[
            "@viditbot",
            f"2 | 2 {_COORD_TEXT}",
            "1 | 2 footage",
            "unrelated earlier post",
        ]
    )
    bodies[_CLIMB_IDS[2]]["mediaDetails"] = _photo()
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[2], _CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1], _CLIMB_IDS[2]]


def test_the_climb_drops_a_post_above_that_carries_no_media():
    # The extra read is for footage. A post above carrying none is a comment, a
    # sign-off or a link the thread did not need, and joining it can only blur
    # the resolution: one stray link there leaves the source ambiguous.
    bodies = _chain(texts=["@viditbot", _COORD_TEXT, "just some words"])
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1], _CLIMB_IDS[2]]


def test_a_coordinate_post_carrying_its_own_media_ends_the_read():
    # The coordinate post is its own footage carrier, so there is nothing above
    # it to look for and the fetch is not spent.
    bodies = _chain(texts=["@viditbot", _COORD_TEXT, "the footage above"])
    bodies[_CLIMB_IDS[1]]["mediaDetails"] = _photo()
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1]]


def test_serial_coordinate_posts_produce_one_detection():
    # A thread geolocating one place per post: the post above the tagged
    # coordinate carries a coordinate of its own, so it is a separate
    # geolocation with its own footage, not this one's. Media there does not
    # buy it in.
    bodies = _chain(texts=["@viditbot", _COORD_TEXT, _EARLIER_COORD_TEXT])
    bodies[_CLIMB_IDS[2]]["mediaDetails"] = _photo()
    with _client(bodies) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]

    [detection] = resolve_threads([acquired.records]).detections
    assert detection.coordinate.lat == pytest.approx(57.567596)


def test_a_coordinate_carried_only_by_a_maps_link_stops_the_climb():
    # The coordinate grammar includes a Google Maps ``@lat,lng`` link, which
    # reaches the raw text as an opaque ``t.co`` token. The climb scans the
    # expanded text, the text the resolution reads, so it stops here instead of
    # walking past the post the analyst geolocated in.
    maps_url = "https://www.google.com/maps/@48.012345,37.802411,15z"
    bodies = _chain(texts=["@viditbot", "Geolocated https://t.co/mapsLINK", _COORD_TEXT])
    bodies[_CLIMB_IDS[1]]["entities"] = {
        "urls": [{"url": "https://t.co/mapsLINK", "expanded_url": maps_url}]
    }
    with _client(bodies) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]

    [detection] = resolve_threads([acquired.records]).detections
    assert detection.coordinate.lat == pytest.approx(48.012345)


def test_an_out_of_bounds_coordinate_stops_the_climb_and_refuses():
    # A typo'd coordinate is still the post the analyst geolocated in. Stopping
    # there is what turns it into the refusal they can act on; climbing past it
    # would mint a detection at a place they never wrote.
    bodies = _chain(texts=["@viditbot", "Grid 233.500000, 999.900000", _COORD_TEXT])
    with _client(bodies) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert resolve_threads([acquired.records]).reason == "coords_invalid"


def test_a_coordinate_further_up_than_the_cap_is_never_fetched():
    # The cap bounds what one pointer costs: three parent fetches beyond the
    # tag, whatever the thread's depth. What was climbed is kept and the
    # coordinate sitting above the cap is neither read nor detected.
    bodies = _chain(texts=["@viditbot", "one", "two", "three", "four", _COORD_TEXT])
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert seen == _CLIMB_IDS[:4]
    assert [r.tweet_id for r in acquired.records] == list(reversed(_CLIMB_IDS[:4]))
    assert resolve_threads([acquired.records]).reason == "coords_missing"


def test_the_cap_bounds_the_footage_read_too():
    # The coordinate met on the last permitted fetch: the footage post above it
    # would be a fourth, so the read ends on the coordinate post. The cap is the
    # bound on both legs.
    bodies = _chain(texts=["@viditbot", "one", "two", _COORD_TEXT, "the footage above"])
    bodies[_CLIMB_IDS[4]]["mediaDetails"] = _photo()
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert seen == _CLIMB_IDS[:4]
    assert [r.tweet_id for r in acquired.records] == list(reversed(_CLIMB_IDS[:4]))


def test_a_bare_tag_under_another_authors_post_acquires_the_tag_alone():
    # The same-author guard ends the climb, which is also the loop guard: a
    # courtesy bare tag under the bot's own reply climbs nothing.
    bodies = _chain(texts=["@viditbot", _COORD_TEXT])
    bodies[_CLIMB_IDS[1]]["user"]["screen_name"] = "someone_else"
    with _client(bodies) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert acquired.records == [acquired.post]


@pytest.mark.parametrize(
    "content",
    [
        pytest.param({"text": "@viditbot geolocated below"}, id="text"),
        pytest.param({"mediaDetails": _photo()}, id="media"),
        pytest.param(
            {
                "quoted_tweet": {
                    "id_str": "1940000000000000900",
                    "user": {"screen_name": "front_cam"},
                    "text": "raw footage",
                    "created_at": "2026-03-11T11:00:00.000Z",
                }
            },
            id="quote",
        ),
    ],
)
def test_a_tag_carrying_content_of_its_own_reads_one_hop_only(content):
    # Content beside the tag is content, and content is read where it sits. Text
    # of its own, media of its own and a quoted post each say the analyst wrote
    # this post rather than pointed with it.
    bodies = _chain(texts=["@viditbot", "one", _COORD_TEXT])
    bodies[_CLIMB_IDS[0]].update(content)
    seen: list[str] = []
    with _client(bodies, seen) as client:
        acquired = acquire_thread(_CLIMB_IDS[0], handle="analyst", client=client)
    assert [r.tweet_id for r in acquired.records] == [_CLIMB_IDS[1], _CLIMB_IDS[0]]
    assert seen == [_CLIMB_IDS[0], _CLIMB_IDS[1]]


def test_a_dot_mention_tag_is_content_and_reads_one_hop_only():
    # The deliberate exclusion: the leading period of ``.@viditbot`` is residue,
    # so the post reads as content. The conservative direction, since reading a
    # pointer as content costs a refusal the analyst fixes by tagging again.
    bodies = _chain(texts=[".@viditbot", "one", _COORD_TEXT])
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
