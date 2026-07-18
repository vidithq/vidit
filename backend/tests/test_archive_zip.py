"""Unit tests for the tweets-only archive intake guard (``archive_zip``)."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from app.services.tweet_ingest import archive_zip
from app.services.tweet_ingest.archive_zip import (
    ArchiveTooLargeError,
    MalformedArchiveError,
    NoTweetsFileError,
    extract_allowlisted,
)

_TWEETS = b'window.YTD.tweets.part0 = [{"tweet": {"id_str": "1", "full_text": "hi"}}]'


def _zip(tmp_path: Path, entries: dict[str, bytes], name: str = "a.zip") -> Path:
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as zf:
        for arcname, data in entries.items():
            zf.writestr(arcname, data)
    return path


def test_allowlist_extracts_only_tweets_and_media(tmp_path):
    src = _zip(
        tmp_path,
        {
            "tweets.js": _TWEETS,
            "tweets_media/1-a.jpg": b"img",
            "direct-messages.js": b"secret DMs",
            "account.js": b"email + phone",
            "deleted-tweets.js": b"deleted",
        },
    )
    dest = tmp_path / "out"
    dest.mkdir()
    extract_allowlisted(src, dest)

    assert (dest / "tweets.js").read_bytes() == _TWEETS
    assert (dest / "tweets_media" / "1-a.jpg").read_bytes() == b"img"
    # Nothing outside the allowlist leaked in.
    assert {p.name for p in dest.rglob("*") if p.is_file()} == {"tweets.js", "1-a.jpg"}


def test_data_prefix_is_normalized(tmp_path):
    # The real export nests under ``data/``; the result is still flat.
    src = _zip(
        tmp_path,
        {
            "data/tweets.js": _TWEETS,
            "data/tweets_media/1-a.jpg": b"img",
            "data/account.js": b"nope",
        },
    )
    dest = tmp_path / "out"
    dest.mkdir()
    extract_allowlisted(src, dest)

    assert (dest / "tweets.js").read_bytes() == _TWEETS
    assert (dest / "tweets_media" / "1-a.jpg").exists()
    assert not (dest / "account.js").exists()


def test_missing_tweets_js_raises(tmp_path):
    src = _zip(tmp_path, {"account.js": b"x", "tweets_media/1-a.jpg": b"img"})
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(NoTweetsFileError):
        extract_allowlisted(src, dest)


def test_zip_slip_member_cannot_escape_dest(tmp_path):
    # A media member with a traversal path must not write outside dest, whether
    # the zip keeps the ``..`` (we write it by basename) or normalizes it away.
    src = _zip(tmp_path, {"tweets.js": _TWEETS, "tweets_media/../../evil.txt": b"pwned"})
    dest = tmp_path / "out"
    dest.mkdir()
    extract_allowlisted(src, dest)

    assert not (tmp_path / "evil.txt").exists()
    assert (dest / "tweets.js").exists()


def test_total_uncompressed_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(archive_zip, "MAX_TOTAL_UNCOMPRESSED_BYTES", 10)
    src = _zip(tmp_path, {"tweets.js": b"x" * 100})
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArchiveTooLargeError):
        extract_allowlisted(src, dest)


def test_per_file_uncompressed_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(archive_zip, "MAX_FILE_UNCOMPRESSED_BYTES", 10)
    src = _zip(tmp_path, {"tweets.js": b"x" * 100})
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArchiveTooLargeError):
        extract_allowlisted(src, dest)


def test_oversized_media_is_skipped_not_fatal(tmp_path, monkeypatch):
    # A real export can carry one long video past the per-file cap (a 229 MB
    # mp4 killed a 3790-post import); the member is dropped, everything else
    # extracts. tweets.js keeps the fatal cap (previous test).
    monkeypatch.setattr(archive_zip, "MAX_FILE_UNCOMPRESSED_BYTES", 10)
    src = _zip(
        tmp_path,
        {
            "data/tweets.js": b"x" * 8,
            "data/tweets_media/big.mp4": b"y" * 100,
            "data/tweets_media/ok.jpg": b"z" * 5,
        },
    )
    dest = tmp_path / "out"
    dest.mkdir()
    extract_allowlisted(src, dest)
    assert (dest / "tweets.js").exists()
    assert (dest / "tweets_media" / "ok.jpg").exists()
    assert not (dest / "tweets_media" / "big.mp4").exists()


def test_malformed_zip_raises(tmp_path):
    src = tmp_path / "bad.zip"
    src.write_bytes(b"this is not a zip")
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(MalformedArchiveError):
        extract_allowlisted(src, dest)


def test_guard_values_are_sanity_caps_not_product_limits():
    """Pin the guard sizes: the zip cap and the total-uncompressed cap are
    anti-abuse ceilings sized far above any legitimate export (the product
    limits are the per-media caps at assemble time), and the per-file cap
    stays at 200 MB."""
    assert archive_zip.MAX_UPLOAD_BYTES == 2 * 1024**3
    assert archive_zip.MAX_TOTAL_UNCOMPRESSED_BYTES == 8 * 1024**3
    assert archive_zip.MAX_FILE_UNCOMPRESSED_BYTES == 200 * 1024**2
