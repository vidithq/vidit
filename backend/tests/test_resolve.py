"""Shared resolution over a thread: coords fallback, source, media split.

These are the derivations parse (human, single-record thread) and detect
(machine, real self-thread) both run, so the two paths agree on which
coordinate, which source URL + date, and which media is footage vs annotation.
"""

from app.services.tweet_ingest.records import QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import resolve_coords, resolve_source, split_media
from app.services.tweet_ingest.syndication import ParsedMedia


def _media(kind: str, origin: str) -> ParsedMedia:
    url = (
        "https://pbs.twimg.com/media/x.jpg" if kind == "image" else "https://video.twimg.com/v.mp4"
    )
    ctype = "image/jpeg" if kind == "image" else "video/mp4"
    return ParsedMedia(kind=kind, remote_url=url, content_type=ctype, origin=origin)  # type: ignore[arg-type]


def _rec(**kw: object) -> TweetRecord:
    base: dict = dict(
        tweet_id="1",
        handle="op",
        text="",
        created_at="2025-01-01T00:00:00Z",
        permalink="https://x.com/op/status/1",
    )
    base.update(kw)
    return TweetRecord(**base)


def test_coords_fallback_to_quoted():
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="here 48.012345, 37.802411", created_at=""
    )
    coords = resolve_coords([_rec(text="geolocated this", quoted=quoted)])
    assert coords and round(coords[0].lat, 3) == 48.012


def test_coords_from_op_preferred_over_quoted():
    quoted = QuotedTweet(tweet_id="2", handle="src", text="50.000000, 30.000000", created_at="")
    coords = resolve_coords([_rec(text="strike 48.012345, 37.802411", quoted=quoted)])
    assert round(coords[0].lat, 3) == 48.012


def test_coords_across_thread_head_media_reply_coord():
    head = _rec(tweet_id="1", text="footage of a strike", media=[_media("video", "op")])
    reply = _rec(
        tweet_id="2", text="location: 48.012345, 37.802411", permalink="https://x.com/op/status/2"
    )
    coords = resolve_coords([head, reply])
    assert round(coords[0].lat, 3) == 48.012


def test_source_is_quoted_tweet_with_its_date():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source([_rec(quoted=quoted)])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_source_uses_first_external_footage_link():
    # An X status link is a footage source now (no longer skipped); first wins.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9", host="x"),
            SourceLink(url="https://t.me/c/1", host="telegram"),
        ]
    )
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_ignores_non_footage_link():
    # A coordinate / article link (host "other") is not a footage source → self.
    record = _rec(external_sources=[SourceLink(url="https://maps.app.goo.gl/x", host="other")])
    url, _ = resolve_source([record])
    assert url == "https://x.com/op/status/1"


def test_split_media_external_source_makes_op_media_proof():
    # The analyst links an external footage source → their own media is annotation
    # (proof); the source footage is elsewhere (empty here, chase would fill it).
    record = _rec(
        media=[_media("image", "op")],
        external_sources=[SourceLink(url="https://x.com/src/status/9", host="x")],
    )
    source, proof = split_media([record])
    assert source == []
    assert [m.kind for m in proof] == ["image"]


def test_source_self_when_no_quote_no_external():
    url, posted = resolve_source([_rec()])
    assert url == "https://x.com/op/status/1"
    assert posted == "2025-01-01T00:00:00Z"


def test_split_media_quoted_is_source_op_is_proof():
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="", created_at="", media=[_media("video", "quote")]
    )
    source, proof = split_media([_rec(media=[_media("image", "op")], quoted=quoted)])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image"]


def test_split_media_self_source_has_no_proof():
    source, proof = split_media([_rec(media=[_media("image", "op")])])
    assert [m.kind for m in source] == ["image"]
    assert proof == []
