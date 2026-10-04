"""Unit tests for the pure text and URL bricks, plus the syndication read.

Route-level integration lives in ``tests/events/test_import.py``.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.tweet_ingest import (
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
    clean_proof_text,
    derive_title,
    extract_coords,
    is_trusted_media_url,
    normalise_tweet_url,
    syndication,
)
from app.services.tweet_ingest.urls import canonical_tweet_url


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
    assert n.handle == handle
    assert n.tweet_id == tweet_id
    # Every spelling of one post round-trips to the same canonical URL.
    assert canonical_tweet_url(n.tweet_id, n.handle) == canonical


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
    # The `.\d{3,}` floor rules out dates, versions and counts.
    assert extract_coords("Today is 2025-11-12 and version 1.2.3") == []
    assert extract_coords("1.5k retweets, 200 likes") == []


def test_decimal_pair_skips_out_of_bounds():
    assert extract_coords("Reading: 200.123456, 50.123456") == []


def test_decimal_pair_trailing_sentence_period():
    # Regression: the trailing '.' is punctuation, not a longer dotted number.
    coords = extract_coords("POV from approx 48.592153, 38.00248.")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.592153)
    assert coords[0].lng == pytest.approx(38.00248)


def test_decimal_pair_rejects_longer_dotted_number():
    assert extract_coords("ratio 48.012345, 37.802411.5 here") == []


def test_decimal_pair_degree_marked():
    coords = extract_coords("Grid 48.621451°  38.041689° confirmed")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.621451)
    assert coords[0].lng == pytest.approx(38.041689)


def test_decimal_degree_marked_still_needs_decimal_floor():
    # Under 3 decimals (a temperature range) is not a coordinate.
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
    assert extract_coords("Temperature 48° in Donetsk yesterday") == []


def test_dms_accepts_typographic_primes():
    # Google Earth emits U+2032 / U+2033, not ASCII quotes.
    coords = extract_coords("Geolocated 12°30′30″N 98°15′15″E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(12 + 30 / 60 + 30 / 3600)
    assert coords[0].lng == pytest.approx(98 + 15 / 60 + 15 / 3600)


def test_dms_prime_tolerates_narrow_no_break_space():
    # Real archives put U+202F before the hemisphere letter.
    coords = extract_coords("12°30′30″ N 98°15′15″ E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(12 + 30 / 60 + 30 / 3600)


def test_dms_no_cross_line_pairing():
    assert extract_coords("12°30′30″N\n98°15′15″E") == []


def test_gmaps_url_extracts_at_segment():
    coords = extract_coords(
        "See https://www.google.com/maps/place/X/@48.012345,37.802411,15z for details"
    )
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(48.012345)
    assert coords[0].lng == pytest.approx(37.802411)


def test_gmaps_url_near_miss_rejects_non_maps_at():
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
    # The hemisphere letter is the discriminator, so one decimal suffices.
    coords = extract_coords("33.1°N 35.5°E")
    assert len(coords) == 1
    assert coords[0].lat == pytest.approx(33.1)
    assert coords[0].lng == pytest.approx(35.5)


def test_decimal_hemisphere_near_miss_requires_adjacent_pair():
    assert extract_coords("vitamin N12.5 area E34.6 batteries") == []
    assert extract_coords("heading 48.5N then onward") == []


def test_decimal_hemisphere_skips_out_of_bounds():
    # The regex matches 233 / 999; bounds rejection drops them.
    assert extract_coords("233.5N 999.9E") == []


def test_decimal_hemisphere_lng_first_not_matched():
    # Known limitation: latitude (N/S) must come first.
    assert extract_coords("35.5°E 33.1°N") == []


def test_extract_coords_no_cross_line_pairing():
    # A lat/lng split across lines is not a pair.
    assert extract_coords("48.012345,\n37.802411") == []
    assert extract_coords("48.5N\n35.5E") == []


def test_extract_coords_dedupes_across_extractors():
    text = (
        "Decimal: 48.012345, 37.802411\n"
        "Maps: https://www.google.com/maps/@48.012345,37.802411,15z\n"
    )
    coords = extract_coords(text)
    assert len(coords) == 1


def test_title_first_non_empty_line():
    assert derive_title("Strike on ammunition depot, Donetsk\n\nMore details below") == (
        "Strike on ammunition depot, Donetsk"
    )


def test_title_keeps_hashtags_and_inline_urls():
    # Taken verbatim: a line is skipped only when it is nothing but coordinates and links.
    text = "Strike on depot https://example.com #ukraine #war"
    assert derive_title(text) == text


def test_title_skips_a_url_only_line():
    assert derive_title("https://example.com") == ""
    assert derive_title("https://example.com\nStrike on depot") == "Strike on depot"
    assert derive_title("") == ""


def test_title_truncates_long_input_on_word_boundary():
    text = "This is a really long title " * 20
    out = derive_title(text)
    assert len(out) <= 120
    # The cut lands on a word boundary, never mid-token like "titl".
    last_word = out.rsplit(" ", 1)[-1]
    assert text.split().count(last_word) > 0, (
        f"truncated title ends on partial token {last_word!r}; full output: {out!r}"
    )


def test_title_hard_cuts_unbroken_token():
    text = "a" * 200
    out = derive_title(text)
    assert len(out) <= 120


@pytest.mark.parametrize(
    "raw",
    [
        "1. Strike near the depot",
        "- Strike near the depot",
        "• Strike near the depot",
    ],
)
def test_title_keeps_a_leading_list_marker(raw):
    assert derive_title(raw) == raw


def test_title_keeps_a_coordinate_inside_prose():
    line = "Strike on depot 48.012345, 37.802411"
    assert derive_title(line) == line


def test_title_skips_coordinate_only_first_line():
    assert derive_title("48.012345, 37.802411\nStrike on the depot") == "Strike on the depot"


def test_title_empty_when_only_coordinates():
    assert derive_title("48.012345, 37.802411") == ""


def test_title_skips_every_coordinate_spelling_alone_on_its_line():
    for line in ("48.012345, 37.802411", "33.1°N 35.5°E", "48°00'45\"N 37°48'08\"E"):
        assert derive_title(f"{line}\nDepot strike") == "Depot strike"


@pytest.mark.parametrize(
    "line",
    [
        # Coordinate plus its maps link, the commonest pairing.
        "48.012345, 37.802411 https://www.google.com/maps/@48.012345,37.802411,15z",
        "48.012345, 37.802411 - https://t.co/abc123",
        "48.012345, 37.802411 | 50.450100, 30.523400",
        "1. 48.012345, 37.802411",
        # Several links alone: how X appends its media wrapper.
        "https://example.com https://t.co/abc123",
    ],
)
def test_title_skips_a_line_of_coordinates_and_links(line):
    # Neither a coordinate nor a link is text, whatever punctuation or marker surrounds them.
    assert derive_title(f"{line}\nDepot strike") == "Depot strike"


def test_title_keeps_a_line_pairing_a_coordinate_with_words():
    # One word beyond the coordinate and the link makes it the title.
    line = "48.012345, 37.802411 depot https://t.co/abc123"
    assert derive_title(line) == line


def test_title_empty_when_every_line_is_coordinates_and_links():
    text = "48.012345, 37.802411\nhttps://t.co/abc123\n50.450100, 30.523400 https://example.com"
    assert derive_title(text) == ""


def test_title_collapses_whitespace():
    assert derive_title("  Strike   on  the depot  ") == "Strike on the depot"


def test_clean_proof_keeps_the_text_and_drops_the_media_wrapper():
    # Only attached-media wrappers go; coordinate lines and list markers stay.
    raw = (
        "1. Strike on the depot 48.012345, 37.802411\n"
        "Footage via https://t.co/abc123\n"
        "- second angle 33.1°N 35.5°E"
    )
    assert clean_proof_text(raw) == (
        "1. Strike on the depot 48.012345, 37.802411\nFootage via\n- second angle 33.1°N 35.5°E"
    )


def test_clean_proof_drops_lines_emptied_by_removal():
    raw = "48.012345, 37.802411\nReal narrative here\nhttps://t.co/xyz"
    assert clean_proof_text(raw) == "48.012345, 37.802411\nReal narrative here"


def test_clean_proof_collapses_internal_whitespace():
    raw = "Strike    on     the   depot"
    assert clean_proof_text(raw) == "Strike on the depot"


def test_clean_proof_empty_input():
    assert clean_proof_text("") == ""
    assert clean_proof_text("\n\nhttps://t.co/x") == ""


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
        # Telegram CDN: apex, shard subdomains and telesco.pe, https only.
        ("https://cdn-telegram.org/file/x.jpg", True),
        ("https://cdn4.cdn-telegram.org/file/x.jpg", True),
        ("https://CDN4.CDN-TELEGRAM.ORG/file/x.jpg", True),  # case-insensitive
        ("https://telesco.pe/file/x.mp4", True),
        ("http://cdn4.cdn-telegram.org/file/x.jpg", False),  # http rejected
        # Look-alikes a substring check would admit.
        ("https://evil-cdn-telegram.org/file/x.jpg", False),
        ("https://cdn-telegram.org.evil.com/file/x.jpg", False),
        ("https://telesco.pe.evil.com/file/x.mp4", False),
        ("https://nottelesco.pe/file/x.mp4", False),
    ],
)
def test_is_trusted_media_url(url, expected):
    assert is_trusted_media_url(url) is expected


_TOMBSTONE_TEXT = "Age-restricted adult content. This content might not be appropriate for all."


@pytest.mark.parametrize(
    "tombstone",
    [{}, {"text": {"text": _TOMBSTONE_TEXT}}],
    ids=["empty", "with-text"],
)
def test_fetch_syndication_tombstone_is_not_accessible(tombstone):
    """A ``200`` ``TweetTombstone`` (login-only tweet) maps to ``TweetNotAccessible`` (404).

    The ``tombstone`` object is sometimes empty, so only ``__typename`` decides.
    """
    body = {"__typename": "TweetTombstone", "tombstone": tombstone}
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=body))
        ) as client,
        pytest.raises(TweetNotAccessible) as excinfo,
    ):
        syndication.fetch_syndication("1657834636792287232", client=client)
    assert str(excinfo.value) == (
        "Post not readable without an X login (age-restricted or withheld)"
    )


def test_fetch_syndication_does_not_cache_a_tombstone():
    """A cached tombstone would keep answering "not readable" after upstream lifts the restriction."""
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"__typename": "TweetTombstone", "tombstone": {}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        for _ in range(2):
            with pytest.raises(TweetNotAccessible):
                syndication.fetch_syndication("1657834636792287232", client=client)
    assert calls == 2


def _fetch(response: httpx.Response) -> dict:

    with httpx.Client(transport=httpx.MockTransport(lambda _request: response)) as client:
        return syndication.fetch_syndication("1657834636792287232", client=client)


def test_fetch_syndication_carries_an_unknown_typename_into_the_failure():
    """An unmapped ``__typename`` is schema drift: it stays a ``TweetFetchFailed`` (502, the alert).

    The message names the value X sent so the Sentry title says what arrived.
    """
    with pytest.raises(TweetFetchFailed) as excinfo:
        _fetch(httpx.Response(200, json={"__typename": "TweetUnavailable"}))
    assert "TweetUnavailable" in str(excinfo.value)


def test_fetch_syndication_empty_body_names_the_rejected_token():
    """``200 {}`` means X rejected the locally computed ``_syndication_token``: import is down for everyone."""
    with pytest.raises(TweetFetchFailed) as excinfo:
        _fetch(httpx.Response(200, json={}))
    assert str(excinfo.value) == "upstream returned an empty body, token rejected"


@pytest.mark.parametrize("status", [429, 500, 503])
def test_fetch_syndication_maps_a_refused_upstream_to_busy(status):
    """Throttling on the shared unauthenticated budget reads as "retry" (503), not a payload change."""
    with pytest.raises(TweetUpstreamBusy):
        _fetch(httpx.Response(status))


def test_fetch_syndication_other_client_errors_stay_plain_failures():
    """Only 429 and X's 5xx are busy; other refusals must not read as "retry in a minute"."""
    with pytest.raises(TweetFetchFailed) as excinfo:
        _fetch(httpx.Response(403))
    assert not isinstance(excinfo.value, TweetUpstreamBusy)
    assert "403" in str(excinfo.value)


def test_fetch_syndication_serves_a_tweet_typed_body_untouched():

    body = {"__typename": "Tweet", "id_str": "1657834636792287232", "text": "hello"}
    assert _fetch(httpx.Response(200, json=body)) == body


def test_cache_lru_evicts_oldest_when_full(monkeypatch):
    """The cache is bounded: a scraper could otherwise accumulate ~10k entries in hours."""
    monkeypatch.setattr(syndication, "_CACHE_MAX_ENTRIES", 3)
    syndication._cache_put("a", {"x": 1})
    syndication._cache_put("b", {"x": 2})
    syndication._cache_put("c", {"x": 3})
    # Touching ``a`` makes ``b`` the LRU entry.
    assert syndication._cache_get("a") == {"x": 1}
    syndication._cache_put("d", {"x": 4})
    assert syndication._cache_get("b") is None
    assert syndication._cache_get("a") == {"x": 1}
    assert syndication._cache_get("c") == {"x": 3}
    assert syndication._cache_get("d") == {"x": 4}


def test_cache_ttl_evicts_expired_on_get(monkeypatch):
    """Expired entries are not served even while still in the dict."""
    monkeypatch.setattr(syndication, "_CACHE_TTL_S", 0.01)
    syndication._cache_put("a", {"x": 1})
    import time as _t

    _t.sleep(0.05)
    assert syndication._cache_get("a") is None


@pytest.fixture(autouse=True)
def _clear_tweet_cache():
    syndication._cache_clear()
    yield
    syndication._cache_clear()
