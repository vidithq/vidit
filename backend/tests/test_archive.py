"""Unit tests for the X-archive acquire adapter.

Runs against the committed synthetic archive (``tests/data/synthetic_archive/``),
never real tweet data. The grammar is pinned in ``tests/ingest_contract``; this
file covers the export reader, the per-thread chase, and the media fetch.
"""

from __future__ import annotations

from pathlib import Path

import httpx

from app.services.tweet_ingest import (
    Detection,
    ParsedMedia,
    TweetRecord,
    archive_media_fetcher,
    chase_thread,
    read_tweets,
    resolve_threads,
    stitch,
)
from tests._fixtures import write_archive_js

ARCHIVE = Path(__file__).parent / "data" / "synthetic_archive"


def _detection(records: list[TweetRecord]) -> Detection:
    """The single detection a one-coordinate thread resolves to."""
    [detection] = resolve_threads([records]).detections
    return detection


def _chased(archive: Path, *, handle: str) -> list[TweetRecord]:
    """The export's records with every stitched thread chased, the chain the
    backfill runs: a pure-disk read, then the one chase step per thread."""
    threads = stitch(read_tweets(archive, handle=handle))
    return [record for thread in threads for record in chase_thread(thread)]


def test_read_tweets_parses_records():
    records = read_tweets(ARCHIVE, handle="ana")
    by_id = {r.tweet_id: r for r in records}
    # 7001 is the fixture's retweet and is dropped; 8001 only says "RT" mid-text.
    assert set(by_id) == {"1001", "2001", "2002", "3001", "4001", "5001", "6001", "8001"}
    assert by_id["1001"].created_at.startswith("2025-11-12")
    # The handle comes from the verified handle, not the archive.
    assert by_id["1001"].handle == "ana"
    # Reply edges survive inline (stitch needs them).
    assert by_id["2002"].in_reply_to_status_id == "2001"
    assert by_id["1001"].in_reply_to_status_id is None
    assert [m.remote_url for m in by_id["1001"].media] == ["tweets_media/1001-AAA1.jpg"]
    assert by_id["3001"].media == []


def test_stitch_and_resolve_over_archive():
    records = read_tweets(ARCHIVE, handle="ana")
    detections = resolve_threads(stitch(records)).detections
    # 1001(1) + thread 2001/2002(1) + 3001(1) + 4001(1) + 5001(0) + 6001(2) + 7001 dropped + 8001(0).
    assert len(detections) == 6
    # The self-thread detection carries the head's media as proof and the head
    # permalink, though the coordinate lived in the reply.
    thread_detection = next(d for d in detections if d.detected_from_url.endswith("/2001"))
    assert thread_detection.source_url is None
    assert thread_detection.source_media == []
    assert [m.remote_url for m in thread_detection.proof_media] == ["tweets_media/2001-BBB2.jpg"]


async def test_archive_media_fetcher_reads_present_and_misses_absent():
    fetch = archive_media_fetcher(ARCHIVE)

    present = ParsedMedia(kind="image", remote_url="tweets_media/1001-AAA1.jpg")
    got = await fetch(present)
    assert got is not None
    data, content_type = got
    assert content_type == "image/jpeg" and len(data) > 0

    absent = ParsedMedia(kind="image", remote_url="tweets_media/nope.jpg")
    assert await fetch(absent) is None


def test_read_tweets_maps_video_media(tmp_path):
    """A video or gif maps to ``tweets_media/<tweet_id>-<basename>`` of the highest-bitrate
    mp4 variant; an entry with no mp4 variant is dropped."""
    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {
                "id_str": "7001",
                "full_text": "clip",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "extended_entities": {
                    "media": [
                        {
                            "type": "video",
                            "media_url_https": "https://pbs.twimg.com/ext_tw_video_thumb/7/img/T.jpg",
                            "video_info": {
                                "variants": [
                                    {
                                        "content_type": "application/x-mpegURL",
                                        "url": "https://video.twimg.com/ext_tw_video/7/pl/PLAYLIST.m3u8",
                                    },
                                    {
                                        "bitrate": "632000",
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/ext_tw_video/7/vid/320x568/LOW.mp4?tag=12",
                                    },
                                    {
                                        "bitrate": "2176000",
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/ext_tw_video/7/vid/720x1280/HIGH.mp4?tag=12",
                                    },
                                ]
                            },
                        },
                        {
                            "type": "animated_gif",
                            "video_info": {
                                "variants": [
                                    {
                                        "bitrate": 0,
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/tweet_video/GIF.mp4",
                                    }
                                ]
                            },
                        },
                        {"type": "video", "video_info": {"variants": []}},
                    ]
                },
            }
        ],
    )
    [record] = read_tweets(archive, handle="ana")
    assert [(m.kind, m.remote_url, m.content_type) for m in record.media] == [
        ("video", "tweets_media/7001-HIGH.mp4", "video/mp4"),
        ("video", "tweets_media/7001-GIF.mp4", "video/mp4"),
    ]


def test_read_tweets_skips_non_numeric_id(tmp_path):
    """An ``id_str`` with path metacharacters is dropped before it builds a media path."""
    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {"id_str": "12345", "full_text": "a", "created_at": ""},
            {"id_str": "../../../../etc/passwd", "full_text": "b", "created_at": ""},
        ],
    )
    records = read_tweets(archive, handle="ana")
    assert [r.tweet_id for r in records] == ["12345"]


def test_read_tweets_drops_retweets(tmp_path):
    """A retweet would attribute a stranger's geolocation to the importer; the
    discriminator is ``_RETWEET_PREFIX_RE`` in ``archive.py``."""
    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {
                "id_str": "9001",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "retweeted": False,
                "full_text": "RT @other_osint: Strike 48.012345, 37.802411 confirmed",
            },
            {
                "id_str": "9002",
                "created_at": "Wed Nov 12 15:00:00 +0000 2025",
                "full_text": "Worth an RT @other_osint: same sector 50.450100, 30.523400",
            },
            # ``text`` instead of ``full_text``: the same prefix still decides.
            {"id_str": "9003", "created_at": "", "text": "RT @a: relayed"},
            # A non-string ``full_text`` must not mask the ``text`` that
            # identifies this as a retweet.
            {"id_str": "9004", "created_at": "", "full_text": 123, "text": "RT @a: relayed"},
        ],
    )
    records = read_tweets(archive, handle="ana")
    assert [r.tweet_id for r in records] == ["9002"]
    detections = resolve_threads(stitch(records)).detections
    assert [d.detected_from_url for d in detections] == ["https://x.com/ana/status/9002"]


def test_several_third_party_status_links_are_ambiguous_no_chase(tmp_path, monkeypatch):
    """Two distinct third-party status links, neither in the archive, are ambiguous:
    nothing is chased. The same id linked twice is one candidate and is chased."""
    import app.services.tweet_ingest.chase.x as x_chase_mod

    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": (
                    "See also https://x.com/other/status/777 Source: https://x.com/other/status/888"
                ),
                "entities": {
                    "urls": [
                        {"url": "https://t.co/a", "expanded_url": "https://x.com/other/status/777"},
                        {"url": "https://t.co/b", "expanded_url": "https://x.com/other/status/888"},
                    ]
                },
            },
            {
                "id_str": "2",
                "created_at": "Wed Nov 12 15:00:00 +0000 2025",
                "full_text": "Source: https://x.com/other/status/888 (again: same link)",
                "entities": {
                    "urls": [
                        {"url": "https://t.co/c", "expanded_url": "https://x.com/other/status/888"},
                        {"url": "https://t.co/d", "expanded_url": "https://x.com/other/status/888"},
                    ]
                },
            },
        ],
    )

    seen_ids: list[str] = []

    def fake_fetch(tweet_id, *, client=None):
        seen_ids.append(tweet_id)
        return {
            "user": {"screen_name": "other"},
            "text": "footage",
            "created_at": "2025-11-12T09:00:00.000Z",
        }

    monkeypatch.setattr(x_chase_mod, "fetch_syndication", fake_fetch)
    records = _chased(archive, handle="ana")
    ambiguous = next(r for r in records if r.tweet_id == "1")
    assert ambiguous.quoted is None
    deduped = next(r for r in records if r.tweet_id == "2")
    assert deduped.quoted is not None
    assert deduped.quoted.tweet_id == "888"
    assert seen_ids == ["888"]  # only the deduped sole candidate was chased


def test_embedded_x_status_in_foreign_host_is_not_chased(tmp_path, monkeypatch):
    """A non-X URL (e.g. an archive.org capture) carrying ``x.com/<w>/status/<id>``
    in its path is not chased: the rule keys on the real host, not a substring."""
    import app.services.tweet_ingest.chase.x as x_chase_mod

    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": "Cited https://t.co/fakearchive",
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/fakearchive",
                            "expanded_url": (
                                "https://web.archive.org/web/20240101000000/"
                                "https://x.com/u/status/123"
                            ),
                        }
                    ]
                },
            }
        ],
    )

    def fake_fetch(tweet_id, *, client=None):
        raise AssertionError("a non-X host must never be chased")

    monkeypatch.setattr(x_chase_mod, "fetch_syndication", fake_fetch)
    [record] = _chased(archive, handle="ana")
    assert record.quoted is None


def _one_tweet_archive(dest: Path, text: str, urls: list[dict], media_url: str) -> None:
    """One export entry with ``text``, its ``entities.urls``, and one photo wrapped as ``media_url``."""
    write_archive_js(
        dest,
        [
            {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": text,
                "entities": {"urls": urls},
                "extended_entities": {
                    "media": [
                        {
                            "type": "photo",
                            "url": media_url,
                            "media_url_https": "https://pbs.twimg.com/media/FAKEOP.jpg",
                        }
                    ]
                },
            }
        ],
    )


def test_a_sole_telegram_link_is_chased_beside_the_posts_own_media(tmp_path, monkeypatch):
    """The photo's ``t.co`` wrapper binds to no entity, so it is not a candidate
    and the chase runs on the one real link."""
    import app.services.tweet_ingest.chase.telegram as telegram_mod
    from app.services.tweet_ingest.records import ChasedPost, ChaseResult

    archive = tmp_path / "arc"
    _one_tweet_archive(
        archive,
        "Geolocated 48.012345, 37.802411\nSource: https://t.co/tg https://t.co/ownPhoto",
        [{"url": "https://t.co/tg", "expanded_url": "https://t.me/chan/42"}],
        "https://t.co/ownPhoto",
    )

    chased: list[str] = []

    def fake_chase(target, *, client=None):
        chased.append(target)
        return ChaseResult(
            outcome="chased",
            post=ChasedPost(url=target, posted_at="2025-11-11T08:00:00+00:00"),
        )

    monkeypatch.setattr(telegram_mod, "chase", fake_chase)
    [record] = _chased(archive, handle="ana")
    assert chased == ["https://t.me/chan/42"]
    detection = _detection([record])
    assert detection.source_url == "https://t.me/chan/42"
    assert "t.co" not in detection.proof_text


def test_a_link_written_inside_prose_is_a_candidate(tmp_path):
    """Link position does not matter, only the candidate count."""
    archive = tmp_path / "arc"
    _one_tweet_archive(
        archive,
        "Filmed by the crew at 48.012345, 37.802411, see https://t.co/ig https://t.co/ownPhoto",
        [{"url": "https://t.co/ig", "expanded_url": "https://www.instagram.com/reel/FAKEREEL01/"}],
        "https://t.co/ownPhoto",
    )
    [record] = read_tweets(archive, handle="ana")
    assert _detection([record]).source_url == "https://www.instagram.com/reel/FAKEREEL01/"


def _cdn_client_factory(handler):
    """An ``httpx.AsyncClient`` factory on a ``MockTransport`` handler, so ``fetch_cdn_media`` stays offline."""
    real = httpx.AsyncClient

    def make_client(**_kwargs):
        return real(transport=httpx.MockTransport(handler))

    return make_client


async def test_fetch_cdn_media_caps_oversized_stream(monkeypatch):
    """An oversized CDN response is dropped fail-soft (media-incomplete), not buffered."""
    import app.services.tweet_ingest.archive as archive_mod

    monkeypatch.setattr(archive_mod, "MEDIA_FETCH_MAX_BYTES", 16)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _cdn_client_factory(lambda _req: httpx.Response(200, content=b"x" * 64)),
    )
    parsed = ParsedMedia(kind="video", remote_url="https://video.twimg.com/big.mp4")
    assert await archive_mod.fetch_cdn_media(parsed) is None


async def test_fetch_cdn_media_returns_within_cap(monkeypatch):
    import app.services.tweet_ingest.archive as archive_mod

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _cdn_client_factory(lambda _req: httpx.Response(200, content=b"tiny-mp4-bytes")),
    )
    parsed = ParsedMedia(kind="video", remote_url="https://video.twimg.com/ok.mp4")
    assert await archive_mod.fetch_cdn_media(parsed) == (b"tiny-mp4-bytes", "video/mp4")


async def test_fetch_cdn_media_retries_a_throttled_cdn(monkeypatch, retry_sleeps):
    """A throttling CDN is retried on ``tweet_ingest.retry``'s schedule, not persisted as media-incomplete."""
    import app.services.tweet_ingest.archive as archive_mod
    from app.services.tweet_ingest import retry

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"tiny-mp4-bytes") if seen[1:] else httpx.Response(503)

    monkeypatch.setattr(httpx, "AsyncClient", _cdn_client_factory(handler))
    parsed = ParsedMedia(kind="video", remote_url="https://video.twimg.com/ok.mp4")

    assert await archive_mod.fetch_cdn_media(parsed) == (b"tiny-mp4-bytes", "video/mp4")
    assert len(seen) == 2
    assert retry_sleeps == [retry.BACKOFF_S[0]]


async def test_fetch_cdn_media_degrades_once_the_retries_are_spent(monkeypatch, retry_sleeps):
    """Past the schedule, the detection lands media-incomplete (fail-soft)."""
    import app.services.tweet_ingest.archive as archive_mod
    from app.services.tweet_ingest import retry

    monkeypatch.setattr(httpx, "AsyncClient", _cdn_client_factory(lambda _req: httpx.Response(503)))
    parsed = ParsedMedia(kind="video", remote_url="https://video.twimg.com/ok.mp4")

    assert await archive_mod.fetch_cdn_media(parsed) is None
    assert retry_sleeps == list(retry.BACKOFF_S)


async def test_archive_media_fetcher_rejects_path_traversal(tmp_path):
    """A ``remote_url`` resolving to a real sibling file outside the extraction dir is not read."""
    archive = tmp_path / "arc"
    (archive / "tweets_media").mkdir(parents=True)
    (tmp_path / "secret.png").write_bytes(b"\x89PNG not yours")
    fetch = archive_media_fetcher(archive)
    escaping = ParsedMedia(kind="image", remote_url="tweets_media/../../secret.png")
    assert await fetch(escaping) is None
