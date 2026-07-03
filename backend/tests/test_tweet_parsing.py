"""Unit tests for the tweet-parsing service.

Scope: extractors + URL normalisation only. The route-level integration
(auth, CSRF, 400/404/502 mapping) lives in ``tests/events/test_import.py``
so the cookie/CSRF fixtures stay in one place.
"""

from __future__ import annotations

import pytest

from app.services.tweet_ingest import (
    InvalidTweetUrl,
    clean_proof_text,
    derive_title,
    extract_coords,
    is_trusted_media_url,
    normalise_tweet_url,
    parse_tweet,
    syndication,
)
from app.services.tweet_ingest.syndication import _extract_external_source_url

# ── URL normalisation ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,canonical,handle,tweet_id",
    [
        (
            "https://x.com/handle/status/1234567890",
            "https://x.com/handle/status/1234567890",
            "handle",
            "1234567890",
        ),
        (
            "https://twitter.com/handle/status/1234567890",
            "https://x.com/handle/status/1234567890",
            "handle",
            "1234567890",
        ),
        (
            "https://www.twitter.com/handle/status/1234567890?s=20&t=ignored#section",
            "https://x.com/handle/status/1234567890",
            "handle",
            "1234567890",
        ),
        (
            "  https://x.com/handle/status/1234567890  ",
            "https://x.com/handle/status/1234567890",
            "handle",
            "1234567890",
        ),
        (
            "https://x.com/i/web/status/1234567890",
            "https://x.com/i/web/status/1234567890",
            "i",
            "1234567890",
        ),
    ],
)
def test_normalise_accepts_valid_tweet_urls(raw, canonical, handle, tweet_id):
    n = normalise_tweet_url(raw)
    assert n.canonical == canonical
    assert n.handle == handle
    assert n.tweet_id == tweet_id


@pytest.mark.parametrize(
    "raw",
    [
        "https://example.com",
        "https://x.com/handle",  # profile, no status
        "https://x.com/handle/status/",  # no id
        "https://x.com/handle/status/notanumber",
        "https://x.com/lists/foo",
        "https://x.com/search?q=ukraine",
        "https://facebook.com/handle/status/123456",
        "ftp://x.com/handle/status/123456",
        "not a url",
        "",
    ],
)
def test_normalise_rejects_non_tweet_urls(raw):
    with pytest.raises(InvalidTweetUrl):
        normalise_tweet_url(raw)


# ── Coordinate extractors ─────────────────────────────────────────────────


def test_decimal_pair_extracts_canonical():
    coords = extract_coords("Strike at 48.012345, 37.802411 in Donetsk")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.012345)
    assert coords[0].lng == pytest.approx(37.802411)


def test_decimal_pair_handles_signed_negatives():
    coords = extract_coords("Position -33.918861, 18.423300")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(-33.918861)
    assert coords[0].lng == pytest.approx(18.423300)


def test_decimal_pair_near_miss_rejects_dates_and_versions():
    # The `.\d{3,}` floor rules out dates / versions / counts.
    assert extract_coords("Today is 2025-11-12 and version 1.2.3") == []
    assert extract_coords("1.5k retweets, 200 likes") == []


def test_decimal_pair_skips_out_of_bounds():
    # 200 isn't a valid latitude — extractor must drop it silently.
    assert extract_coords("Reading: 200.123456, 50.123456") == []


def test_decimal_pair_trailing_sentence_period():
    # A coord ending a sentence must still parse — the '.' is punctuation, not a
    # longer dotted number. (Corpus bug: the old guard dropped ~365 of these.)
    coords = extract_coords("POV from approx 48.592153, 38.00248.")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.592153)
    assert coords[0].lng == pytest.approx(38.00248)


def test_decimal_pair_rejects_longer_dotted_number():
    # `…411.5` is a longer dotted number, not a clean coord → reject.
    assert extract_coords("ratio 48.012345, 37.802411.5 here") == []


def test_decimal_pair_degree_marked():
    # Decimal degrees written with the ° symbol and no hemisphere letter.
    coords = extract_coords("Grid 48.621451°  38.041689° confirmed")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.621451)
    assert coords[0].lng == pytest.approx(38.041689)


def test_decimal_degree_marked_still_needs_decimal_floor():
    # Degree-marked but <3 decimals (a temperature range) is not a coordinate.
    assert extract_coords("range 5.5° 10.2° today") == []


def test_dms_extracts_decimal():
    coords = extract_coords("Coordinates 48°00'45\"N 37°48'08\"E in the report.")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.0 + 0.0 / 60.0 + 45.0 / 3600.0)
    assert coords[0].lng == pytest.approx(37.0 + 48.0 / 60.0 + 8.0 / 3600.0)


def test_dms_southern_western_hemispheres_negate():
    coords = extract_coords("Position 33°55'07\"S 18°25'24\"W")
    assert len(coords) == 1
    assert coords[0].lat < 0
    assert coords[0].lng < 0


def test_dms_near_miss_rejects_bare_degree_symbol():
    # No hemisphere letter → not a DMS pair.
    assert extract_coords("Temperature 48° in Donetsk yesterday") == []


def test_dms_accepts_typographic_primes():
    # Google-Earth-style output uses ′ (U+2032) / ″ (U+2033), not ASCII ' ".
    coords = extract_coords("Geolocated 12°30′30″N 98°15′15″E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(12 + 30 / 60 + 30 / 3600)
    assert coords[0].lng == pytest.approx(98 + 15 / 60 + 15 / 3600)


def test_dms_prime_tolerates_narrow_no_break_space():
    # Real archives put U+202F (narrow NBSP) before the hemisphere letter.
    coords = extract_coords("12°30′30″ N 98°15′15″ E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(12 + 30 / 60 + 30 / 3600)


def test_dms_no_cross_line_pairing():
    # Inter-half separator is newline-safe: lat / lng on separate lines don't pair.
    assert extract_coords("12°30′30″N\n98°15′15″E") == []


def test_gmaps_url_extracts_at_segment():
    coords = extract_coords(
        "See https://www.google.com/maps/place/X/@48.012345,37.802411,15z for details"
    )
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.012345)
    assert coords[0].lng == pytest.approx(37.802411)


def test_gmaps_url_near_miss_rejects_non_maps_at():
    # An at-mention is not a maps link.
    assert extract_coords("Tagging @user1 @user2 for visibility") == []


@pytest.mark.parametrize(
    "text",
    [
        "Hit confirmed 33.123°N 35.456°E overnight",  # ° + suffix letter
        "Coordinates: 33.123N, 35.456E",  # no °, comma separator, suffix
        "Location N33.123 E35.456 per the report",  # prefix letter, no °
        "Grid 33.123° N / 35.456° E",  # spaced letter, slash separator
    ],
)
def test_decimal_hemisphere_extracts_each_ordering(text):
    coords = extract_coords(text)
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(33.123)
    assert coords[0].lng == pytest.approx(35.456)


def test_decimal_hemisphere_southern_western_negate():
    coords = extract_coords("Position 33.918861S 18.423300W")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(-33.918861)
    assert coords[0].lng == pytest.approx(-18.423300)


def test_decimal_hemisphere_single_fractional_digit():
    # One decimal place is enough — the hemisphere letter is the discriminator.
    coords = extract_coords("33.1°N 35.5°E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(33.1)
    assert coords[0].lng == pytest.approx(35.5)


def test_decimal_hemisphere_near_miss_requires_adjacent_pair():
    # Hemisphere-tagged numbers separated by prose aren't a coordinate pair.
    assert extract_coords("vitamin N12.5 area E34.6 batteries") == []
    # A lone hemisphere number with no lng half is not a pair.
    assert extract_coords("heading 48.5N then onward") == []


def test_decimal_hemisphere_skips_out_of_bounds():
    # `\d{1,3}` lets the regex match 233 / 999, but bounds rejection drops it.
    assert extract_coords("233.5N 999.9E") == []


def test_decimal_hemisphere_lng_first_not_matched():
    # Documented limitation: latitude (N/S) must come first.
    assert extract_coords("35.5°E 33.1°N") == []


def test_extract_coords_no_cross_line_pairing():
    # A coordinate lives on one line; a lat/lng split across lines is not a pair.
    assert extract_coords("48.012345,\n37.802411") == []
    assert extract_coords("48.5N\n35.5E") == []


def test_extract_coords_dedupes_across_extractors():
    text = (
        "Decimal: 48.012345, 37.802411\n"
        "Maps: https://www.google.com/maps/@48.012345,37.802411,15z\n"
    )
    coords = extract_coords(text)
    assert len(coords) == 1


def test_extract_coords_caps_at_three_candidates():
    text = (
        "48.111111, 37.111111\n48.222222, 37.222222\n48.333333, 37.333333\n48.444444, 37.444444\n"
    )
    coords = extract_coords(text)
    assert len(coords) == 3


# ── Title heuristic ───────────────────────────────────────────────────────


def test_title_first_non_empty_line():
    assert derive_title("Strike on ammunition depot, Donetsk\n\nMore details below") == (
        "Strike on ammunition depot, Donetsk"
    )


def test_title_strips_hashtags_and_urls():
    text = "Strike on depot https://example.com #ukraine #war"
    assert derive_title(text) == "Strike on depot"


def test_title_empty_when_only_hashtags_or_urls():
    assert derive_title("#ukraine #war") == ""
    assert derive_title("https://example.com") == ""
    assert derive_title("") == ""


def test_title_truncates_long_input_on_word_boundary():
    text = "This is a really long title " * 20
    out = derive_title(text)
    assert len(out) <= 120
    # Word-boundary cut: don't end on partial mid-token like "titl".
    # ``derive_title`` looks back to the last space inside the window
    # and trims at it — so the trailing fragment is always a complete
    # word the input actually carried.
    last_word = out.rsplit(" ", 1)[-1]
    assert text.split().count(last_word) > 0, (
        f"truncated title ends on partial token {last_word!r}; full output: {out!r}"
    )


def test_title_hard_cuts_unbroken_token():
    text = "a" * 200
    out = derive_title(text)
    assert len(out) <= 120


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1. Strike near the depot", "Strike near the depot"),
        ("2) Strike near the depot", "Strike near the depot"),
        ("- Strike near the depot", "Strike near the depot"),
        ("• Strike near the depot", "Strike near the depot"),
    ],
)
def test_title_strips_leading_list_marker(raw, expected):
    assert derive_title(raw) == expected


def test_title_strips_bare_coordinates_from_line():
    assert derive_title("Strike on depot 48.012345, 37.802411") == "Strike on depot"


def test_title_skips_coordinate_only_first_line():
    # A line that is nothing but coordinates must not become the title.
    assert derive_title("48.012345, 37.802411\nStrike on the depot") == "Strike on the depot"


def test_title_empty_when_only_coordinates():
    assert derive_title("48.012345, 37.802411") == ""


def test_title_removes_empty_brackets_left_by_coord_strip():
    assert derive_title("Strike (48.012345, 37.802411) hit") == "Strike hit"


def test_title_trims_dangling_label_punctuation():
    # The bare-coord strip leaves "Coordinates:"; the trailing colon is trimmed.
    assert derive_title("Coordinates: 48.012345, 37.802411") == "Coordinates"


def test_title_skips_line_with_no_word_after_cleanup():
    # Emoji + coordinate only → no real word → fall through to the next line.
    assert derive_title("📍 48.012345, 37.802411\nDepot strike") == "Depot strike"


# ── Proof text cleanup ────────────────────────────────────────────────────


def test_clean_proof_strips_coords_tco_and_markers():
    raw = (
        "1. Strike on the depot 48.012345, 37.802411\n"
        "Footage via https://t.co/abc123\n"
        "- second angle 33.1°N 35.5°E"
    )
    assert clean_proof_text(raw) == "Strike on the depot\nFootage via\nsecond angle"


def test_clean_proof_drops_lines_emptied_by_removal():
    # A line that is only a coordinate / only a shortlink leaves nothing.
    raw = "48.012345, 37.802411\nReal narrative here\nhttps://t.co/xyz"
    assert clean_proof_text(raw) == "Real narrative here"


def test_clean_proof_collapses_internal_whitespace():
    raw = "Strike    on     the   depot"
    assert clean_proof_text(raw) == "Strike on the depot"


def test_clean_proof_empty_input():
    assert clean_proof_text("") == ""
    assert clean_proof_text("48.012345, 37.802411\n\nhttps://t.co/x") == ""


# ── Trusted media host ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://pbs.twimg.com/media/foo.jpg", True),
        ("https://video.twimg.com/ext_tw_video/123.mp4", True),
        ("https://PBS.twimg.com/MEDIA/foo.jpg", True),  # case-insensitive host
        ("http://pbs.twimg.com/media/foo.jpg", False),  # http rejected
        ("https://evil.com/media/foo.jpg", False),
        ("https://pbs.twimg.com.evil.com/media/foo.jpg", False),
        ("not a url at all", False),
    ],
)
def test_is_trusted_media_url(url, expected):
    assert is_trusted_media_url(url) is expected


# ── External source-URL extraction ────────────────────────────────────────


def _entities_with_urls(urls: list[dict]) -> dict:
    return {"entities": {"urls": urls}}


def test_extract_external_source_url_returns_telegram_link():
    body = _entities_with_urls(
        [
            {
                "expanded_url": "https://t.me/somechannel/18880",
                "url": "https://t.co/abc123",
            }
        ]
    )
    assert _extract_external_source_url(body) == "https://t.me/somechannel/18880"


def test_extract_external_source_url_skips_x_self_references():
    body = _entities_with_urls(
        [
            {"expanded_url": "https://x.com/foo/status/123"},
            {"expanded_url": "https://twitter.com/bar/status/456"},
            {"expanded_url": "https://www.x.com/baz"},
            {"expanded_url": "https://t.me/realsource/9"},
        ]
    )
    # x.com / twitter.com / www.x.com all skipped → first non-X wins.
    assert _extract_external_source_url(body) == "https://t.me/realsource/9"


def test_extract_external_source_url_skips_bare_tco():
    # Raw t.co (unexpanded) is the wrapped shortlink, not the source.
    body = _entities_with_urls(
        [
            {"expanded_url": "https://t.co/xyz789"},
            {"expanded_url": "https://www.facebook.com/reel/123"},
        ]
    )
    assert _extract_external_source_url(body) == "https://www.facebook.com/reel/123"


def test_extract_external_source_url_returns_none_when_only_x_links():
    body = _entities_with_urls(
        [
            {"expanded_url": "https://x.com/foo/status/123"},
            {"expanded_url": "https://twitter.com/bar/status/456"},
        ]
    )
    assert _extract_external_source_url(body) is None


def test_extract_external_source_url_tolerates_missing_or_malformed_entities():
    # Defensive against schema drift — anything unexpected returns None.
    assert _extract_external_source_url({}) is None
    assert _extract_external_source_url({"entities": None}) is None
    assert _extract_external_source_url({"entities": {"urls": None}}) is None
    assert _extract_external_source_url({"entities": {"urls": [{}]}}) is None
    assert _extract_external_source_url({"entities": {"urls": [{"expanded_url": ""}]}}) is None


# ── parse_tweet end-to-end ────────────────────────────────────────────────


def _stub_syndication(monkeypatch, body: dict) -> None:
    """Replace ``fetch_syndication`` with a constant-returning stub.

    The real ``fetch_syndication`` makes a network call; these tests
    exercise everything *around* the fetch so we keep them hermetic.
    """
    monkeypatch.setattr(syndication, "fetch_syndication", lambda tweet_id, client=None: body)


def _user_block(handle: str) -> dict:
    return {"id_str": "1", "screen_name": handle}


def _photo_media(filename: str) -> dict:
    return {"type": "photo", "media_url_https": f"https://pbs.twimg.com/media/{filename}"}


def _video_media(url: str) -> dict:
    return {
        "type": "video",
        "video_info": {
            "variants": [{"content_type": "video/mp4", "bitrate": 2_000_000, "url": url}]
        },
    }


def test_parse_tweet_source_url_prefers_quoted_tweet(monkeypatch):
    """When the OP quote-retweets, ``source_url`` points at the quoted
    tweet — that's the OSINT-correct attribution. The OP's URL is
    kept on ``original_tweet_url`` so the form can still credit the
    analyst in the proof body."""
    _stub_syndication(
        monkeypatch,
        {
            "user": _user_block("alice"),
            "created_at": "2026-05-01T00:00:00.000Z",
            "text": "Strike near Konstyantynivka — 48.012345, 37.802411",
            "entities": {
                "urls": [
                    {"expanded_url": "https://t.me/realsource/9"},
                ]
            },
            "mediaDetails": [_photo_media("op.jpg")],
            "quoted_tweet": {
                "id_str": "9999",
                "user": _user_block("victim"),
                "text": "footage of an attack",
                "mediaDetails": [_video_media("https://video.twimg.com/v.mp4")],
            },
        },
    )
    parsed = parse_tweet("https://x.com/alice/status/1234567890")
    assert parsed.source_url == "https://x.com/victim/status/9999"
    assert parsed.original_tweet_url == "https://x.com/alice/status/1234567890"
    assert parsed.quoted_tweet is not None
    assert parsed.quoted_tweet.author_handle == "victim"


def test_parse_tweet_source_url_falls_back_to_external_url(monkeypatch):
    """No quote → first non-X URL in ``entities.urls`` wins. Catches
    the OSINT convention of typing ``Source: https://t.me/...`` in
    the body."""
    _stub_syndication(
        monkeypatch,
        {
            "user": _user_block("alice"),
            "created_at": "2026-05-01T00:00:00.000Z",
            "text": "Strike — Source: https://t.co/abc",
            "entities": {
                "urls": [
                    {"expanded_url": "https://t.me/somechannel/100"},
                ]
            },
            "mediaDetails": [_photo_media("op.jpg")],
        },
    )
    parsed = parse_tweet("https://x.com/alice/status/1234567890")
    assert parsed.source_url == "https://t.me/somechannel/100"
    assert parsed.quoted_tweet is None


def test_parse_tweet_source_url_falls_back_to_op(monkeypatch):
    """No quote and no external URL → ``source_url`` equals the OP URL.
    The analyst is expected to override the form field manually."""
    _stub_syndication(
        monkeypatch,
        {
            "user": _user_block("alice"),
            "created_at": "2026-05-01T00:00:00.000Z",
            "text": "Strike at 48.012345, 37.802411 — no link",
            "entities": {"urls": []},
            "mediaDetails": [_photo_media("op.jpg")],
        },
    )
    parsed = parse_tweet("https://x.com/alice/status/1234567890")
    assert parsed.source_url == "https://x.com/alice/status/1234567890"
    assert parsed.original_tweet_url == parsed.source_url


def test_parse_tweet_merges_op_and_quote_media_with_origin_tags(monkeypatch):
    """OP media is tagged ``origin="op"``, quoted-tweet media
    ``origin="quote"`` — informational only on the frontend but
    used in the proof-body attribution and for future smarter
    splits."""
    _stub_syndication(
        monkeypatch,
        {
            "user": _user_block("alice"),
            "created_at": "2026-05-01T00:00:00.000Z",
            "text": "annotated screenshots",
            "entities": {"urls": []},
            "mediaDetails": [_photo_media("a.jpg"), _photo_media("b.jpg")],
            "quoted_tweet": {
                "id_str": "9999",
                "user": _user_block("victim"),
                "text": "the actual footage",
                "mediaDetails": [_video_media("https://video.twimg.com/v.mp4")],
            },
        },
    )
    parsed = parse_tweet("https://x.com/alice/status/1234567890")
    op_media = [m for m in parsed.media if m.origin == "op"]
    quote_media = [m for m in parsed.media if m.origin == "quote"]
    assert len(op_media) == 2
    assert all(m.kind == "image" for m in op_media)
    assert len(quote_media) == 1
    assert quote_media[0].kind == "video"


def test_parse_tweet_coord_extraction_falls_back_to_quoted_text(monkeypatch):
    """If the OP text has no recognised coordinates, the extractor
    re-runs over the quoted tweet's text. Real OSINT posts sometimes
    say "here ↓" and let the quoted source carry the coords."""
    _stub_syndication(
        monkeypatch,
        {
            "user": _user_block("alice"),
            "created_at": "2026-05-01T00:00:00.000Z",
            "text": "here ↓",
            "entities": {"urls": []},
            "mediaDetails": [],
            "quoted_tweet": {
                "id_str": "9999",
                "user": _user_block("victim"),
                "text": "footage at 48.012345, 37.802411",
                "mediaDetails": [],
            },
        },
    )
    parsed = parse_tweet("https://x.com/alice/status/1234567890")
    assert len(parsed.parsed_coords) == 1
    assert parsed.parsed_coords[0].lat == pytest.approx(48.012345)
    assert parsed.parsed_coords[0].lng == pytest.approx(37.802411)


# ── Cache behaviour ───────────────────────────────────────────────────────


def test_cache_lru_evicts_oldest_when_full(monkeypatch):
    """The cache evicts the least-recently-used entry once
    ``_CACHE_MAX_ENTRIES`` is exceeded.

    Without the bound, a scraper hammering varied tweet IDs through the
    rate limit could accumulate ~10k entries in a few hours (1h TTL,
    30/min limit) before any natural eviction.
    """
    # Shrink the bound so the test runs cheap.
    monkeypatch.setattr(syndication, "_CACHE_MAX_ENTRIES", 3)
    syndication._cache_put("a", {"x": 1})
    syndication._cache_put("b", {"x": 2})
    syndication._cache_put("c", {"x": 3})
    # Touch ``a`` so ``b`` is now the LRU entry.
    assert syndication._cache_get("a") == {"x": 1}
    syndication._cache_put("d", {"x": 4})
    # ``b`` should have been evicted, ``a`` / ``c`` / ``d`` kept.
    assert syndication._cache_get("b") is None
    assert syndication._cache_get("a") == {"x": 1}
    assert syndication._cache_get("c") == {"x": 3}
    assert syndication._cache_get("d") == {"x": 4}


def test_cache_ttl_evicts_expired_on_get(monkeypatch):
    """Expired entries are not served — even when they're still in the dict."""
    monkeypatch.setattr(syndication, "_CACHE_TTL_S", 0.01)
    syndication._cache_put("a", {"x": 1})
    import time as _t

    _t.sleep(0.05)
    assert syndication._cache_get("a") is None


# ── Cache hygiene (test isolation) ────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_tweet_cache():
    syndication._cache_clear()
    yield
    syndication._cache_clear()
