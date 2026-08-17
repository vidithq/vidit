"""Shared resolution over a thread: coordinates, source, media split.

These are the derivations every entry runs (the bot, the pasted import, the
archive backfill), so the three agree on which coordinate, which source URL and
date, and which media is footage vs annotation.
"""

from app.services.tweet_ingest.records import QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import (
    resolve_source,
    resolve_thread,
    split_media,
)
from app.services.tweet_ingest.syndication import ParsedMedia

_INSTAGRAM = SourceLink(
    url="https://www.instagram.com/reel/FAKEREEL01/",
    shortlink="https://t.co/fakeIG",
)


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
    )
    base.update(kw)
    return TweetRecord(**base)


def _coords(thread: list[TweetRecord]):
    resolved = resolve_thread(thread)
    assert resolved is not None
    return resolved.coords


# ── Coordinates ───────────────────────────────────────────────────────────


def test_a_coordinate_only_in_the_quoted_post_is_not_read():
    # It is the quoted author's geolocation, not the analyst's.
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="here 48.012345, 37.802411", created_at=""
    )
    assert _coords([_rec(text="geolocated this", quoted=quoted)]) == []


def test_coords_come_from_the_analysts_own_text():
    quoted = QuotedTweet(tweet_id="2", handle="src", text="50.000000, 30.000000", created_at="")
    coords = _coords([_rec(text="strike 48.012345, 37.802411", quoted=quoted)])
    assert round(coords[0].lat, 3) == 48.012


def test_coords_across_thread_head_media_reply_coord():
    head = _rec(tweet_id="1", text="footage of a strike", media=[_media("video", "op")])
    reply = _rec(tweet_id="2", text="location: 48.012345, 37.802411")
    assert round(_coords([head, reply])[0].lat, 3) == 48.012


def test_every_coordinate_makes_a_candidate():
    # No cap: the 6-decimal dedup is the only guard.
    text = "\n".join(f"4{i}.111111, 3{i}.222222" for i in range(5))
    assert len(_coords([_rec(text=text)])) == 5


def test_an_out_of_bounds_pair_is_named_as_such():
    resolved = resolve_thread([_rec(text="somewhere at 991.123456, 37.802411")])
    assert resolved is not None
    assert resolved.coords == []
    assert resolved.coords_out_of_bounds is True


# ── Source ────────────────────────────────────────────────────────────────


def test_source_is_quoted_tweet_with_its_date():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source([_rec(quoted=quoted)])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_source_uses_the_sole_candidate_link():
    record = _rec(external_sources=[SourceLink(url="https://x.com/a/status/9")])
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_is_host_blind():
    # An article, a TikTok, an Instagram reel: a sole link is the source
    # whatever the host, stored link-only because nothing chases it.
    for url in (
        "https://www.instagram.com/reel/FAKEREEL01/",
        "https://www.tiktok.com/@war/video/7",
        "https://example-news.test/2026/03/04/report",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (url, None)


def test_source_none_when_several_candidate_links():
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9"),
            SourceLink(url="https://t.me/c/1"),
        ]
    )
    assert resolve_source([record]) == (None, None)


def test_the_same_link_repeated_is_one_candidate():
    link = SourceLink(url="https://x.com/a/status/9")
    assert resolve_source([_rec(external_sources=[link, link])])[0] == "https://x.com/a/status/9"


def test_x_and_twitter_variants_of_one_status_are_one_candidate():
    # One status id spelled four ways is one candidate, not an ambiguity.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9"),
            SourceLink(url="https://twitter.com/a/status/9"),
            SourceLink(url="https://x.com/a/status/9/"),
            SourceLink(url="https://x.com/a/status/9?s=20"),
        ]
    )
    assert resolve_source([record])[0] == "https://x.com/a/status/9"


def test_tracking_query_and_trailing_slash_do_not_split_a_candidate():
    record = _rec(
        external_sources=[
            SourceLink(url="https://t.me/chan/7"),
            SourceLink(url="https://t.me/chan/7/?utm_source=x"),
        ]
    )
    assert resolve_source([record])[0] == "https://t.me/chan/7"


def test_an_x_link_naming_no_status_is_excluded():
    # A profile link points at no post, so the status link beside it is the sole
    # candidate and wins the slot.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/osinttechnical"),
            SourceLink(url="https://x.com/osinttechnical/status/2028478401154084878"),
        ]
    )
    assert resolve_source([record])[0] == (
        "https://x.com/osinttechnical/status/2028478401154084878"
    )


def test_the_analysts_own_status_link_is_excluded():
    # The "previous geolocation" self-reference: a cross-reference, not a
    # source, so the third-party status is the sole candidate.
    record = _rec(
        handle="analyst",
        external_sources=[
            SourceLink(url="https://x.com/analyst/status/111"),
            SourceLink(url="https://x.com/CENTCOM"),
            SourceLink(url="https://x.com/CENTCOM/status/222"),
        ],
    )
    assert resolve_source([record])[0] == "https://x.com/CENTCOM/status/222"


def test_the_own_status_exclusion_is_case_insensitive():
    # X status URLs don't lowercase the handle segment.
    record = _rec(
        handle="analyst",
        external_sources=[SourceLink(url="https://x.com/Analyst/status/111")],
    )
    assert resolve_source([record]) == (None, None)


def test_a_google_maps_link_is_excluded():
    for url in (
        "https://maps.app.goo.gl/x",
        "https://www.google.com/maps/@48.012345,37.802411,15z",
        "https://maps.google.com/?q=48.012345,37.802411",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (None, None)


def test_a_quote_outranks_a_candidate_link():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    record = _rec(external_sources=[_INSTAGRAM], quoted=quoted)
    url, posted = resolve_source([record])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_source_none_when_no_quote_and_no_link():
    # The head's own post is provenance (detected_from_url), never a deduced
    # self-source.
    assert resolve_source([_rec()]) == (None, None)


def test_the_displaced_candidates_land_as_mirrors():
    record = _rec(
        text="Strike at 48.012345, 37.802411",
        external_sources=[_INSTAGRAM, SourceLink(url="https://x.com/a/status/9")],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url is None
    assert resolved.secondary_source_urls == [_INSTAGRAM.url, "https://x.com/a/status/9"]


# ── Proof ─────────────────────────────────────────────────────────────────


def test_proof_keeps_a_reference_link_readable():
    # Raw tweet text carries only opaque t.co wrappers; the entity's expansion is
    # what keeps the link readable in the stored proof.
    record = _rec(
        text="Strike at 48.012345, 37.802411\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.proof_text.splitlines()[-1] == f"Source: {_INSTAGRAM.url}"


def test_proof_keeps_the_coordinate_line():
    resolved = resolve_thread([_rec(text="Strike on the depot\n48.012345, 37.802411")])
    assert resolved is not None
    assert resolved.proof_text == "Strike on the depot\n48.012345, 37.802411"


def test_proof_drops_a_shortlink_bound_to_no_entity():
    # The wrapper X appends for the post's own attached media.
    record = _rec(text="Footage below 48.012345, 37.802411 https://t.co/mediaWrapper")
    resolved = resolve_thread([record])
    assert resolved is not None
    assert "t.co" not in resolved.proof_text


# ── Media split ───────────────────────────────────────────────────────────


def test_split_media_promotes_the_first_own_video_to_source():
    # Nothing else can fill the source slot and the proof document embeds images
    # only, so leaving the video in proof would drop it at persistence.
    record = _rec(media=[_media("image", "op"), _media("video", "op"), _media("video", "op")])
    source, proof = split_media([record])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image", "video"]


def test_split_media_promotes_the_first_video_in_thread_order():
    head = _rec(tweet_id="1", media=[_media("video", "op")])
    reply = _rec(tweet_id="2", media=[_media("video", "op")])
    source, proof = split_media([head, reply])
    assert source == [head.media[0]]
    assert proof == [reply.media[0]]


def test_split_media_quote_keeps_precedence_over_an_own_video():
    # A quote is the source even when it carried no media at all, so the
    # analyst's own video stays annotation.
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    source, proof = split_media([_rec(media=[_media("video", "op")], quoted=quoted)])
    assert source == []
    assert [m.kind for m in proof] == ["video"]


def test_split_media_a_linked_source_makes_op_media_proof():
    # The analyst links a source, so their own media is annotation; the footage
    # is elsewhere (empty here, the chase would fill it).
    record = _rec(
        media=[_media("image", "op")],
        external_sources=[SourceLink(url="https://x.com/src/status/9")],
    )
    source, proof = split_media([record])
    assert source == []
    assert [m.kind for m in proof] == ["image"]


def test_split_media_quoted_is_source_op_is_proof():
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="", created_at="", media=[_media("video", "quote")]
    )
    source, proof = split_media([_rec(media=[_media("image", "op")], quoted=quoted)])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image"]


def test_split_media_own_photo_is_proof_without_quote():
    # A photo is never promoted: it is a map crop, a screenshot, an annotation.
    source, proof = split_media([_rec(media=[_media("image", "op")])])
    assert source == []
    assert [m.kind for m in proof] == ["image"]
