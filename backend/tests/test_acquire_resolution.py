"""The tweet-id resolution brick: quoted sub-record + source-link classification.

Pure-function tests over canned syndication bodies (no network): the inline
quoted tweet must resolve to a full sub-record (id, handle, date, media), and
``entities.urls`` must classify by host so a consumer can tell a chaseable X
source from off-platform Telegram / YouTube.
"""

from app.services.tweet_ingest.acquire import _quoted_record
from app.services.tweet_ingest.syndication import classify_source_host, extract_source_links


def test_classify_source_host():
    assert classify_source_host("https://x.com/a/status/1") == "x"
    assert classify_source_host("https://twitter.com/a/status/1") == "x"
    assert classify_source_host("https://t.me/chan/42") == "telegram"
    assert classify_source_host("https://youtu.be/xyz") == "youtube"
    assert classify_source_host("https://www.youtube.com/watch?v=x") == "youtube"
    assert classify_source_host("https://example.org/x") == "other"


def test_extract_source_links_classifies_dedupes_skips_tco():
    body = {
        "entities": {
            "urls": [
                {"expanded_url": "https://t.me/foo/123"},
                {"expanded_url": "https://x.com/bar/status/456"},
                {"expanded_url": "https://t.me/foo/123"},  # duplicate
                {"expanded_url": "https://t.co/wrapped"},  # skipped (wrapper)
                {"expanded_url": "https://youtu.be/xyz"},
            ]
        }
    }
    assert extract_source_links(body) == [
        ("https://t.me/foo/123", "telegram"),
        ("https://x.com/bar/status/456", "x"),
        ("https://youtu.be/xyz", "youtube"),
    ]


def test_extract_source_links_empty_without_entities():
    assert extract_source_links({}) == []


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
