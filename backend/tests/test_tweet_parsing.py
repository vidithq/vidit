"""Unit tests for the pure text and URL bricks, plus the syndication read.

Route-level integration lives in ``tests/events/test_import.py``.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

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


_DMS_48 = (48 + 45 / 3600, 37 + 48 / 60 + 8 / 3600)
_DMS_12 = (12 + 30 / 60 + 30 / 3600, 98 + 15 / 60 + 15 / 3600)


@pytest.mark.parametrize(
    ("text", "lat", "lng"),
    [
        pytest.param(
            "Strike at 48.012345, 37.802411 in Donetsk", 48.012345, 37.802411, id="decimal"
        ),
        pytest.param("Position -33.918861, 18.423300", -33.918861, 18.4233, id="decimal-negative"),
        # The trailing '.' is punctuation, not a longer dotted number.
        pytest.param(
            "POV from approx 48.592153, 38.00248.", 48.592153, 38.00248, id="sentence-end"
        ),
        pytest.param("Grid 48.621451°  38.041689° confirmed", 48.621451, 38.041689, id="degrees"),
        pytest.param("Coordinates 48°00'45\"N 37°48'08\"E in the report.", *_DMS_48, id="dms"),
        pytest.param(
            "Position 33°55'07\"S 18°25'24\"W",
            -(33 + 55 / 60 + 7 / 3600),
            -(18 + 25 / 60 + 24 / 3600),
            id="dms-south-west",
        ),
        # Google Earth emits U+2032 / U+2033, not ASCII quotes.
        pytest.param("Geolocated 12°30′30″N 98°15′15″E", *_DMS_12, id="dms-primes"),
        # Real archives put U+202F before the hemisphere letter.
        pytest.param("12°30′30″\u202fN 98°15′15″\u202fE", *_DMS_12, id="dms-narrow-space"),
        pytest.param(
            "See https://www.google.com/maps/place/X/@48.012345,37.802411,15z for details",
            48.012345,
            37.802411,
            id="maps-url",
        ),
        pytest.param("Hit confirmed 33.123°N 35.456°E overnight", 33.123, 35.456, id="hemi-suffix"),
        pytest.param("Coordinates: 33.123N, 35.456E", 33.123, 35.456, id="hemi-comma"),
        pytest.param("Location N33.123 E35.456 per the report", 33.123, 35.456, id="hemi-prefix"),
        pytest.param("Grid 33.123° N / 35.456° E", 33.123, 35.456, id="hemi-slash"),
        pytest.param("Position 33.918861S 18.423300W", -33.918861, -18.4233, id="hemi-south-west"),
        # The hemisphere letter is the discriminator, so one decimal suffices.
        pytest.param("33.1°N 35.5°E", 33.1, 35.5, id="hemi-one-decimal"),
        pytest.param(
            "Decimal: 48.012345, 37.802411\n"
            "Maps: https://www.google.com/maps/@48.012345,37.802411,15z\n",
            48.012345,
            37.802411,
            id="deduped-across-extractors",
        ),
    ],
)
def test_extract_coords_reads_one_pair(text, lat, lng):
    [coords] = extract_coords(text)
    assert coords.lat == pytest.approx(lat)
    assert coords.lng == pytest.approx(lng)


@pytest.mark.parametrize(
    "text",
    [
        # The `.\d{3,}` floor rules out dates, versions and counts.
        pytest.param("Today is 2025-11-12 and version 1.2.3", id="date-and-version"),
        pytest.param("1.5k retweets, 200 likes", id="counts"),
        pytest.param("Reading: 200.123456, 50.123456", id="out-of-bounds"),
        pytest.param("ratio 48.012345, 37.802411.5 here", id="longer-dotted-number"),
        pytest.param("range 5.5° 10.2° today", id="degrees-under-three-decimals"),
        pytest.param("Temperature 48° in Donetsk yesterday", id="bare-degree"),
        pytest.param("Tagging @user1 @user2 for visibility", id="mentions"),
        pytest.param("vitamin N12.5 area E34.6 batteries", id="hemi-not-adjacent"),
        pytest.param("heading 48.5N then onward", id="hemi-lone-latitude"),
        pytest.param("233.5N 999.9E", id="hemi-out-of-bounds"),
        # Known limitation: latitude (N/S) must come first.
        pytest.param("35.5°E 33.1°N", id="hemi-longitude-first"),
        pytest.param("48.012345,\n37.802411", id="decimal-across-lines"),
        pytest.param("48.5N\n35.5E", id="hemi-across-lines"),
        pytest.param("12°30′30″N\n98°15′15″E", id="dms-across-lines"),
    ],
)
def test_extract_coords_reads_no_pair(text):
    assert extract_coords(text) == []


def test_every_regex_digit_parses():
    # ``scan_coords`` converts its groups unguarded: every character ``\d`` matches must read.
    digits = [chr(code) for code in range(sys.maxunicode + 1) if re.fullmatch(r"\d", chr(code))]
    assert len(digits) > 10
    for digit in digits:
        assert int(digit * 2) == int(digit) * 11
        assert float(f"{digit}.{digit * 3}") == pytest.approx(int(digit) * 1.111)


def test_unicode_digits_read_as_a_coordinate():
    pair, dms = extract_coords("٤٨.٠١٢٣٤٥, ٣٧.٨٠٢٤١١ and ٤٨°٠٠'٤٥\"N ٣٧°٤٨'٠٨\"W")
    assert (pair.lat, pair.lng) == pytest.approx((48.012345, 37.802411))
    assert (dms.lat, dms.lng) == pytest.approx((48.0125, -(37 + 48 / 60 + 8 / 3600)))


# Sanitized posts whose text holds the coordinate, or none for a coordinate-free post.
_GOLDEN = json.loads((Path(__file__).parent / "typology" / "fixtures.json").read_text("utf-8"))


@pytest.mark.parametrize("fixture", _GOLDEN, ids=lambda fixture: fixture["typology"])
def test_golden_fixture_still_parses(fixture: dict) -> None:
    text = fixture["op_text"] + (
        "\n" + fixture["quoted_text"] if fixture.get("quoted_text") else ""
    )
    coords = extract_coords(text)
    expected = fixture.get("expected_coord")
    if expected is None:
        assert coords == [], f"expected no coordinate, parser invented {coords}"
    else:
        assert any(
            c.lat == pytest.approx(expected["lat"], abs=1e-4)
            and c.lng == pytest.approx(expected["lng"], abs=1e-4)
            for c in coords
        ), f"parsed {coords} != expected {expected}"


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
