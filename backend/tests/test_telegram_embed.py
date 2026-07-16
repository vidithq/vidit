"""Unit tests for the Telegram footage chase (offline).

Two surfaces: the SSRF URL guard (``_telegram_post_url`` admits nothing but a
public t.me post) and the embed parser (``fetch_telegram_embed`` over synthetic
HTML carrying the real ``tgme_*`` classes). Every fetch runs through an
``httpx.MockTransport`` client, so no request leaves the box.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.tweet_ingest.telegram import (
    TelegramEmbed,
    _telegram_post_url,
    fetch_telegram_embed,
)

# ── SSRF URL guard ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://t.me/somechannel/12345", "https://t.me/somechannel/12345"),
        ("http://t.me/somechannel/12345", "https://t.me/somechannel/12345"),  # normalised to https
        (
            "https://t.me/somechannel/12345?single",
            "https://t.me/somechannel/12345",
        ),  # query dropped
        ("https://www.t.me/chan/9", "https://t.me/chan/9"),  # www. host accepted
        ("https://T.ME/Chan/9", "https://t.me/Chan/9"),  # case-insensitive host
    ],
)
def test_post_url_accepts_public_posts(url: str, expected: str) -> None:
    assert _telegram_post_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://t.me/somechannel",  # channel only, no post id
        "https://t.me/c/1234567890/42",  # private channel form (extra segment)
        "https://t.me/joinchat/AAAAAE",  # invite link, non-numeric id
        "https://t.me/chan/notanumber",  # non-numeric id
        "https://t.me/chan/12/extra",  # extra path segment
        "https://evil.com/chan/12",  # non-telegram host
        "https://t.me.evil.com/chan/12",  # look-alike host
        "https://user:pass@t.me/chan/12",  # embedded credentials
        "https://t.me:8080/chan/12",  # non-standard port
        "ftp://t.me/chan/12",  # non-http scheme
        "not a url at all",
    ],
)
def test_post_url_rejects_everything_else(url: str) -> None:
    assert _telegram_post_url(url) is None


def test_disallowed_url_never_fetches() -> None:
    """The guard runs before any socket: a non-post URL returns None without the
    transport ever being touched."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("a disallowed URL must never be fetched")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        assert fetch_telegram_embed("https://evil.com/chan/12", client=client) is None
        assert fetch_telegram_embed("https://t.me/joinchat/AAA", client=client) is None
    finally:
        client.close()


# ── Embed parser ──────────────────────────────────────────────────────────

_DATE = "2026-03-04T13:20:00+00:00"


def _client(html_text: str, *, status: int = 200) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("embed") == "1"
        return httpx.Response(status, text=html_text)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _raising_client(exc: httpx.HTTPError) -> httpx.Client:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise exc

    return httpx.Client(transport=httpx.MockTransport(handler))


def _fetch(html_text: str, *, status: int = 200) -> TelegramEmbed | None:
    client = _client(html_text, status=status)
    try:
        return fetch_telegram_embed("https://t.me/somechannel/12345", client=client)
    finally:
        client.close()


_PHOTO_HTML = (
    '<div class="tgme_widget_message js-widget_message">'
    '<a class="tgme_widget_message_photo_wrap" '
    "style=\"background-image:url('https://cdn4.cdn-telegram.org/file/photo1.jpg')\"></a>"
    f'<time datetime="{_DATE}" class="time"></time>'
    "</div>"
)

_VIDEO_HTML = (
    '<div class="tgme_widget_message">'
    '<video class="tgme_widget_message_video" '
    'src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)

# Video and photo both present + trusted: the video is the footage, the photo is
# a poster, so only the video is taken.
_VIDEO_AND_PHOTO_HTML = (
    '<div class="tgme_widget_message">'
    '<a class="tgme_widget_message_photo_wrap" '
    "style=\"background-image:url('https://cdn4.cdn-telegram.org/file/poster.jpg')\"></a>"
    '<video src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)

# Sensitive post: the embed ships the date and a withheld-media marker; the
# poster photo tag must not be mistaken for footage.
_SENSITIVE_HTML = (
    '<div class="tgme_widget_message">'
    '<a class="tgme_widget_message_photo_wrap" '
    "style=\"background-image:url('https://cdn4.cdn-telegram.org/file/poster.jpg')\"></a>"
    '<div class="message_media_not_supported">Please open Telegram to view this post</div>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)

# The message renders, carries a date, but the media URL is a look-alike host.
_UNTRUSTED_MEDIA_HTML = (
    '<div class="tgme_widget_message">'
    '<video src="https://evil-cdn-telegram.org/file/x.mp4"></video>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)

# telesco.pe is the other trusted Telegram media base.
_TELESCO_HTML = (
    '<div class="tgme_widget_message">'
    '<video src="https://telesco.pe/file/video9.mp4"></video>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)

# Standard embed chrome: the footer "VIEW IN TELEGRAM" link rides on normal posts
# too, so it must NOT suppress real inlined media (video or photo).
_VIDEO_WITH_CHROME_HTML = (
    '<div class="tgme_widget_message">'
    '<video src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>'
    '<a class="tgme_widget_message_link">VIEW IN TELEGRAM</a>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)
_PHOTO_WITH_CHROME_HTML = (
    '<div class="tgme_widget_message">'
    '<a class="tgme_widget_message_photo_wrap" '
    "style=\"background-image:url('https://cdn4.cdn-telegram.org/file/photo1.jpg')\"></a>"
    '<a class="tgme_widget_message_link">VIEW IN TELEGRAM</a>'
    f'<time datetime="{_DATE}" class="time"></time>'
    "</div>"
)

# A genuine withheld-media marker AND an inlined video: the video is real footage
# and wins; the marker only suppresses the poster-photo path.
_WITHHELD_MARKER_WITH_VIDEO_HTML = (
    '<div class="tgme_widget_message">'
    '<video src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>'
    '<div class="message_media_not_supported">Please open Telegram to view this post</div>'
    f'<time datetime="{_DATE}"></time>'
    "</div>"
)


def test_photo_embed_yields_date_and_image() -> None:
    embed = _fetch(_PHOTO_HTML)
    assert embed is not None
    assert embed.posted_at == _DATE
    assert [(m.kind, m.remote_url) for m in embed.media] == [
        ("image", "https://cdn4.cdn-telegram.org/file/photo1.jpg")
    ]


def test_video_embed_yields_date_and_mp4() -> None:
    embed = _fetch(_VIDEO_HTML)
    assert embed is not None
    assert embed.posted_at == _DATE
    assert [(m.kind, m.content_type) for m in embed.media] == [("video", "video/mp4")]


def test_video_preferred_over_poster_photo() -> None:
    embed = _fetch(_VIDEO_AND_PHOTO_HTML)
    assert embed is not None
    assert [m.kind for m in embed.media] == ["video"]
    assert embed.media[0].remote_url == "https://cdn4.cdn-telegram.org/file/video1.mp4"


def test_telesco_pe_media_is_trusted() -> None:
    embed = _fetch(_TELESCO_HTML)
    assert embed is not None
    assert [m.remote_url for m in embed.media] == ["https://telesco.pe/file/video9.mp4"]


def test_view_in_telegram_chrome_does_not_withhold_video() -> None:
    # "VIEW IN TELEGRAM" is standard footer chrome, not a withhold signal: a real
    # inlined video alongside it is still captured.
    embed = _fetch(_VIDEO_WITH_CHROME_HTML)
    assert embed is not None
    assert [m.kind for m in embed.media] == ["video"]


def test_view_in_telegram_chrome_does_not_withhold_photo() -> None:
    # Same for a served wrapper photo: the footer link does not turn it into a
    # withheld poster.
    embed = _fetch(_PHOTO_WITH_CHROME_HTML)
    assert embed is not None
    assert [(m.kind, m.remote_url) for m in embed.media] == [
        ("image", "https://cdn4.cdn-telegram.org/file/photo1.jpg")
    ]


def test_inlined_video_wins_over_withheld_marker() -> None:
    # Even with a genuine withheld-media marker present, an inlined trusted video
    # is real footage and is captured; the marker only suppresses the poster photo.
    embed = _fetch(_WITHHELD_MARKER_WITH_VIDEO_HTML)
    assert embed is not None
    assert [m.kind for m in embed.media] == ["video"]


def test_sensitive_post_yields_date_only() -> None:
    embed = _fetch(_SENSITIVE_HTML)
    assert embed is not None
    assert embed.posted_at == _DATE
    assert embed.media == []


def test_untrusted_media_host_dropped_date_kept() -> None:
    embed = _fetch(_UNTRUSTED_MEDIA_HTML)
    assert embed is not None
    assert embed.posted_at == _DATE
    assert embed.media == []


def test_embed_unavailable_yields_none() -> None:
    assert _fetch('<div class="tgme_page">Post not found</div>') is None


def test_hostile_html_yields_none() -> None:
    assert _fetch("<html><body>totally unrelated markup</body></html>") is None
    assert _fetch("") is None


def test_message_without_date_or_media_yields_none() -> None:
    # A rendered post whose embed carries neither a date nor a trusted media: no
    # useful signal, so nothing to attach.
    assert _fetch('<div class="tgme_widget_message"></div>') is None


def test_non_200_yields_none() -> None:
    assert _fetch(_PHOTO_HTML, status=404) is None
    assert _fetch(_PHOTO_HTML, status=302) is None


def test_transport_error_yields_none() -> None:
    client = _raising_client(httpx.ConnectError("boom"))
    try:
        assert fetch_telegram_embed("https://t.me/somechannel/12345", client=client) is None
    finally:
        client.close()
