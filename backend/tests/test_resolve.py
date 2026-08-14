"""Shared resolution over a thread: coords fallback, source, media split.

These are the derivations parse (human, single-record thread) and detect
(machine, real self-thread) both run, so the two paths agree on which
coordinate, which source URL + date, and which media is footage vs annotation.
"""

from app.services.tweet_ingest.records import QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import (
    resolve_coords,
    resolve_source,
    resolve_thread,
    split_media,
)
from app.services.tweet_ingest.syndication import ParsedMedia

_INSTAGRAM = SourceLink(
    url="https://www.instagram.com/reel/FAKEREEL01/",
    host="other",
    shortlink="https://t.co/fakeIG",
)
_FACEBOOK = SourceLink(
    url="https://www.facebook.com/watch/?v=FAKEVIDEO02",
    host="other",
    shortlink="https://t.co/fakeFB",
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


def test_source_uses_sole_external_footage_link():
    # A single footage link (an X status here) is the declared source.
    record = _rec(external_sources=[SourceLink(url="https://x.com/a/status/9", host="x")])
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_none_when_several_distinct_footage_links():
    # Two distinct footage candidates across hosts (an X status + a Telegram
    # link): ambiguous, no heuristic picks one, the source stays empty for
    # review.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9", host="x"),
            SourceLink(url="https://t.me/c/1", host="telegram"),
        ]
    )
    url, posted = resolve_source([record])
    assert url is None
    assert posted is None


def test_source_same_footage_link_repeated_is_one_candidate():
    # The same URL linked twice dedupes to one candidate, not an ambiguity.
    link = SourceLink(url="https://x.com/a/status/9", host="x")
    record = _rec(external_sources=[link, link])
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_x_and_twitter_variants_of_one_status_are_one_candidate():
    # x.com and twitter.com links (plus a trailing slash / query variant) that
    # point at the SAME status id dedupe by status id to a single candidate, not
    # three ambiguous ones, so the source resolves instead of being lost.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9", host="x"),
            SourceLink(url="https://twitter.com/a/status/9", host="x"),
            SourceLink(url="https://x.com/a/status/9/", host="x"),
            SourceLink(url="https://x.com/a/status/9?s=20", host="x"),
        ]
    )
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_other_host_dedupes_on_trailing_slash_and_query():
    # Two Telegram links to the same post differing only by a trailing slash /
    # query are one candidate, not a false ambiguity.
    record = _rec(
        external_sources=[
            SourceLink(url="https://t.me/chan/7", host="telegram"),
            SourceLink(url="https://t.me/chan/7/?embed=1", host="telegram"),
        ]
    )
    url, posted = resolve_source([record])
    assert url == "https://t.me/chan/7"
    assert posted is None


def test_source_skips_leading_profile_link_status_link_wins():
    # Regression: entities.urls carries the profile link before the status link
    # (the order X returns them in). classify_source_host now demotes the
    # profile to host "other", so the status link (the actual footage) wins the
    # source slot instead of the profile.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/osinttechnical", host="other"),
            SourceLink(url="https://x.com/osinttechnical/status/2028478401154084878", host="x"),
        ]
    )
    url, posted = resolve_source([record])
    assert url == "https://x.com/osinttechnical/status/2028478401154084878"
    assert posted is None


def test_source_skips_own_status_link_sole_third_party_status_wins():
    # Regression: the "previous geolocation" self-reference tweets. entities.urls
    # carries the analyst's own earlier status first (host "x", same handle as
    # the record), then a profile link (host "other"), then the third-party
    # status that is the actual footage. The own-status link is a
    # cross-reference, not footage, so it is skipped, leaving exactly one
    # footage candidate: the third-party status.
    record = _rec(
        handle="analyst",
        external_sources=[
            SourceLink(url="https://x.com/analyst/status/111", host="x"),
            SourceLink(url="https://x.com/CENTCOM", host="other"),
            SourceLink(url="https://x.com/CENTCOM/status/222", host="x"),
        ],
    )
    url, posted = resolve_source([record])
    assert url == "https://x.com/CENTCOM/status/222"
    assert posted is None


def test_source_skips_own_status_link_case_insensitive():
    # The handle comparison is case-insensitive: X status URLs don't lowercase
    # the handle segment.
    record = _rec(
        handle="analyst",
        external_sources=[SourceLink(url="https://x.com/Analyst/status/111", host="x")],
    )
    url, posted = resolve_source([record])
    assert url is None
    assert posted is None


def test_source_ignores_non_footage_link():
    # A coordinate / article link (host "other") is not a footage source, so the
    # thread has declared no source at all.
    record = _rec(external_sources=[SourceLink(url="https://maps.app.goo.gl/x", host="other")])
    url, posted = resolve_source([record])
    assert url is None
    assert posted is None


def test_source_line_designates_an_off_vocabulary_link():
    # "Source: <url>" names the footage explicitly, so the link fills the slot
    # whatever its host. Instagram is outside the chase vocabulary, so it is
    # stored link-only: no date, and no media follows it.
    record = _rec(
        text="Strike on the depot\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    url, posted = resolve_source([record])
    assert url == _INSTAGRAM.url
    assert posted is None
    assert split_media([record]) == ([], [])


def test_source_line_designation_binds_on_the_expanded_url_too():
    # An archive-era entity may carry no t.co wrapper; the token then binds to
    # the expanded URL, the same rule the bot's S: line runs.
    record = _rec(
        text="Source: https://www.tiktok.com/@war/video/7",
        external_sources=[SourceLink(url="https://www.tiktok.com/@war/video/7", host="other")],
    )
    assert resolve_source([record])[0] == "https://www.tiktok.com/@war/video/7"


def test_source_line_ignores_a_token_bound_to_nothing():
    # The wrapper X appends for attached media sits on no entity, so it
    # designates nothing and the thread declares no source.
    record = _rec(text="Source: https://t.co/mediaWrapper")
    assert resolve_source([record]) == (None, None)


def test_source_line_survives_the_posts_own_media_wrapper():
    # X appends the wrapper of the post's own attached media to the end of the
    # text, so a one-token designation line reaches storage as two tokens. The
    # wrapper is named by the post's media entities, so the line still reads as
    # the analyst wrote it. Instagram is host "other", which the sole-candidate
    # rule can never pick: only the designation puts it in the slot.
    record = _rec(
        text="Strike on the depot\nSource: https://t.co/fakeIG https://t.co/ownPhoto",
        external_sources=[_INSTAGRAM],
        media=[_media("image", "op")],
        media_shortlinks=["https://t.co/ownPhoto"],
    )
    assert resolve_source([record]) == (_INSTAGRAM.url, None)


def test_source_line_with_two_written_links_designates_nothing():
    # Same two-token shape, but neither token is the post's own media: the
    # analyst named two links, which is ambiguous, so the line designates
    # nothing and the slot stays empty for review.
    record = _rec(
        text="Source: https://t.co/fakeIG https://t.co/fakeFB",
        external_sources=[_INSTAGRAM, _FACEBOOK],
        media_shortlinks=["https://t.co/ownPhoto"],
    )
    assert resolve_source([record]) == (None, None)


def test_source_line_with_an_unknown_extra_token_designates_nothing():
    # An extra token the post's media entities do not name is not assumed to be
    # a wrapper: only entity-declared media is dropped, so the line stays
    # two-token and reads as ambiguous rather than silently taking the first.
    record = _rec(
        text="Source: https://t.co/fakeIG https://t.co/unknown",
        external_sources=[_INSTAGRAM],
        media_shortlinks=["https://t.co/ownPhoto"],
    )
    assert resolve_source([record]) == (None, None)


def test_source_line_inside_prose_is_not_a_designation():
    # Whole-line only: a reference written mid-sentence is a proof link, and the
    # sole-candidate rule (host "other" here) still declines it.
    record = _rec(
        text="Filmed by the crew, Source: https://t.co/fakeIG and mirrored elsewhere",
        external_sources=[_INSTAGRAM],
    )
    assert resolve_source([record]) == (None, None)


def test_source_line_rejects_an_x_link_that_names_no_status():
    # On X, footage lives at a status. A profile link on a Source: line credits
    # an author, so it never fills the slot however explicit the line is.
    record = _rec(
        text="Source: https://x.com/Osinttechnical",
        external_sources=[SourceLink(url="https://x.com/Osinttechnical", host="other")],
    )
    assert resolve_source([record]) == (None, None)


def test_source_line_rejects_the_authors_own_status():
    # A link back to the analyst's own post is a cross-reference, never footage,
    # designated or not.
    record = _rec(
        handle="analyst",
        text="Source: https://x.com/Analyst/status/111",
        external_sources=[SourceLink(url="https://x.com/Analyst/status/111", host="x")],
    )
    assert resolve_source([record]) == (None, None)


def test_two_source_lines_naming_different_links_designate_nothing():
    # Ambiguous designation: the sole-candidate rule decides instead, and with
    # two distinct footage candidates it declines too.
    record = _rec(
        text="Source: https://x.com/a/status/9\nSource: https://t.me/chan/7",
        external_sources=[
            SourceLink(url="https://x.com/a/status/9", host="x"),
            SourceLink(url="https://t.me/chan/7", host="telegram"),
        ],
    )
    assert resolve_source([record]) == (None, None)


def test_the_same_link_designated_twice_is_one_designation():
    link = SourceLink(url="https://x.com/a/status/9", host="x")
    record = _rec(
        text="Source: https://x.com/a/status/9\nSource: https://x.com/a/status/9?s=20",
        external_sources=[link, SourceLink(url="https://x.com/a/status/9?s=20", host="x")],
    )
    assert resolve_source([record])[0] == "https://x.com/a/status/9"


def test_source_line_outranks_the_sole_footage_link():
    # The designation is explicit, the host rule is inference: the article wins
    # the slot and the footage-host link it displaces lands as a mirror.
    record = _rec(
        text="Report: https://x.com/a/status/9\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM, SourceLink(url="https://x.com/a/status/9", host="x")],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url == _INSTAGRAM.url
    assert resolved.secondary_source_urls == ["https://x.com/a/status/9"]


def test_quote_outranks_the_source_line_designation():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    record = _rec(text="Source: https://t.co/fakeIG", external_sources=[_INSTAGRAM], quoted=quoted)
    url, posted = resolve_source([record])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_proof_keeps_a_designated_reference_link_readable():
    # Raw tweet text carries only opaque t.co wrappers and clean_proof_text
    # strips them, which would leave a dangling "Source:" label in the proof.
    record = _rec(
        text="Strike at 48.012345, 37.802411\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.proof_text.splitlines()[-1] == f"Source: {_INSTAGRAM.url}"


def test_proof_still_strips_a_shortlink_bound_to_no_entity():
    record = _rec(text="Footage below 48.012345, 37.802411 https://t.co/mediaWrapper")
    resolved = resolve_thread([record])
    assert resolved is not None
    assert "t.co" not in resolved.proof_text


def test_split_media_promotes_the_first_own_video_to_source():
    # Nothing else can fill the source slot and the proof document embeds images
    # only, so leaving the video in proof would drop it at persistence.
    record = _rec(media=[_media("image", "op"), _media("video", "op"), _media("video", "op")])
    source, proof = split_media([record])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image", "video"]


def test_split_media_promotes_the_first_video_in_thread_order():
    head = _rec(tweet_id="1", media=[_media("video", "op")])
    reply = _rec(tweet_id="2", permalink="https://x.com/op/status/2", media=[_media("video", "op")])
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


def test_source_none_when_no_quote_no_external():
    # No quote and no footage link: the source stays empty. The head's permalink
    # is provenance (detected_from_url), never a deduced self-source.
    url, posted = resolve_source([_rec()])
    assert url is None
    assert posted is None


def test_split_media_quoted_is_source_op_is_proof():
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="", created_at="", media=[_media("video", "quote")]
    )
    source, proof = split_media([_rec(media=[_media("image", "op")], quoted=quoted)])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image"]


def test_split_media_own_media_is_proof_without_quote():
    # No quote: the thread's own media is annotation (proof), never promoted to
    # footage. The source slot stays empty.
    source, proof = split_media([_rec(media=[_media("image", "op")])])
    assert source == []
    assert [m.kind for m in proof] == ["image"]
