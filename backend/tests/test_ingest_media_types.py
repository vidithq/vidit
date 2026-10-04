"""One stored type per imported media kind, whichever entry read the post.

A fetched photo is re-encoded at ingest to the format the display derivatives
use; no payload field or filename decides its type.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from app.services.evidence_processing import DERIVATIVE_CONTENT_TYPE
from app.services.storage import ALLOWED_IMAGE_TYPES, prepare_media
from app.services.tweet_ingest.archive import read_tweets
from app.services.tweet_ingest.records import (
    PHOTO_CONTENT_TYPE,
    VIDEO_CONTENT_TYPE,
    ParsedMedia,
)
from app.services.tweet_ingest.syndication import extract_media
from tests._fixtures import write_archive_js


def test_an_imported_photo_is_stored_as_the_derivative_format() -> None:
    """An original and its ``_hero`` / ``_thumb`` siblings share one format."""
    assert PHOTO_CONTENT_TYPE == DERIVATIVE_CONTENT_TYPE
    assert PHOTO_CONTENT_TYPE in ALLOWED_IMAGE_TYPES


def test_the_stored_type_follows_the_kind_and_nothing_else() -> None:
    assert ParsedMedia(kind="image", remote_url="x").content_type == PHOTO_CONTENT_TYPE
    assert ParsedMedia(kind="video", remote_url="x").content_type == VIDEO_CONTENT_TYPE


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (4, 4), color=(10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_png_bytes_land_as_the_one_photo_format() -> None:
    """``prepare_media`` returns bytes in the imported-photo type, whatever the post served."""
    prepared = prepare_media(_png_bytes(), PHOTO_CONTENT_TYPE)

    assert prepared.content_type == PHOTO_CONTENT_TYPE
    with Image.open(io.BytesIO(prepared.cleaned)) as stored:
        assert stored.format == "JPEG"
    for derivative in (prepared.hero, prepared.thumb):
        assert derivative is not None
        with Image.open(io.BytesIO(derivative)) as image:
            assert image.format == "JPEG"


def test_a_png_reads_the_same_off_the_export_and_off_syndication(tmp_path: Path) -> None:
    """The same PNG gets one stored type whichever entry read the post."""
    url = "https://pbs.twimg.com/media/SHOT.png"
    archive = tmp_path / "arc"
    write_archive_js(
        archive,
        [
            {
                "id_str": "7001",
                "full_text": "shot",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "extended_entities": {"media": [{"type": "photo", "media_url_https": url}]},
            }
        ],
    )

    [record] = read_tweets(archive, handle="ana")
    [from_export] = record.media
    [from_syndication] = extract_media(
        {"mediaDetails": [{"type": "photo", "media_url_https": url}]}
    )

    assert from_export.content_type == from_syndication.content_type == PHOTO_CONTENT_TYPE
    # The basename only names the file the backfill reads off disk.
    assert from_export.remote_url == "tweets_media/7001-SHOT.png"
