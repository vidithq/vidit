"""One stored type per imported media kind, whichever entry read the post.

A photo an entry fetches is machine-fetched bytes, not an analyst's upload, so
it is re-encoded at ingest to the one format the display derivatives already
use. Nothing derives a photo's type from a payload field or a filename any
more, which is what used to let a PNG land as a PNG off an export and as a
mislabelled JPEG off syndication.
"""

from __future__ import annotations

import io
import json
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
from app.services.tweet_ingest.syndication import _extract_media


def test_an_imported_photo_is_stored_as_the_derivative_format() -> None:
    """The one format, pinned against the pipeline that decided it: an original
    and its ``_hero`` / ``_thumb`` siblings read as one format everywhere."""
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
    """The re-encode itself: the write path declares the imported-photo type and
    ``prepare_media`` returns bytes in it, whatever the post served. The cap
    applies before this, to the fetched bytes (``validate_bytes``)."""
    prepared = prepare_media(_png_bytes(), PHOTO_CONTENT_TYPE)

    assert prepared.content_type == PHOTO_CONTENT_TYPE
    with Image.open(io.BytesIO(prepared.cleaned)) as stored:
        assert stored.format == "JPEG"
    for derivative in (prepared.hero, prepared.thumb):
        assert derivative is not None
        with Image.open(io.BytesIO(derivative)) as image:
            assert image.format == "JPEG"


def test_a_png_reads_the_same_off_the_export_and_off_syndication(tmp_path: Path) -> None:
    """The asymmetry this closes: the export used to type a photo from its
    filename and syndication used to hardcode one, so the same PNG was two
    different stored types depending on the entry that read the post."""
    url = "https://pbs.twimg.com/media/SHOT.png"
    archive = tmp_path / "arc"
    archive.mkdir()
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = "
        + json.dumps(
            [
                {
                    "tweet": {
                        "id_str": "7001",
                        "full_text": "shot",
                        "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                        "extended_entities": {"media": [{"type": "photo", "media_url_https": url}]},
                    }
                }
            ]
        ),
        encoding="utf-8",
    )

    [record] = read_tweets(archive, handle="ana")
    [from_export] = record.media
    [from_syndication] = _extract_media(
        {"mediaDetails": [{"type": "photo", "media_url_https": url}]}
    )

    assert from_export.content_type == from_syndication.content_type == PHOTO_CONTENT_TYPE
    # The export still reads the basename: it names the file the backfill reads
    # off disk, and nothing else.
    assert from_export.remote_url == "tweets_media/7001-SHOT.png"
