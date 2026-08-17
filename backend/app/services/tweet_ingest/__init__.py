"""Tweet ingestion: acquire a tweet / thread, extract structured data.

Single-responsibility bricks behind one import surface:

* ``urls``: the URL vocabulary (read a post URL to its id, write one back,
  the host predicates), pure string work.
* ``records``: the normalized acquire units (``TweetRecord``, ``ChasedPost``,
  ``ParsedMedia``), source-agnostic.
* ``extract``: pure text core (coordinates, title, proof body), reused by
  every path.
* ``stitch``: recombine records into threads (union-find on reply edges).
* ``resolve``: the engine, a thread to one ``ResolvedThread``.
* ``detect``: the machine path, a thread to ``DetectedGeoloc`` DTOs plus the
  reason it produced none.
* ``syndication``: X I/O (fetch + token + cache, payload mappers).
* ``chase``: one module per technology behind one dispatcher, for the single
  fetch spent on a post's declared source.
* ``acquire``: the live acquisition, a tweet id plus the same author's post it
  replies to, which is the thread the bot and the paste both resolve.
* ``archive``: the export reader, plus the CDN media fetchers.

The four pure modules (``records``, ``extract``, ``stitch``, ``resolve``) read
no I/O module, which ``tests/test_ingest_boundaries.py`` states. Callers import
the public surface from this package; the module layout is an internal detail.
``errors`` is a leaf module so any brick can raise the shared failures without a
cycle.
"""

from __future__ import annotations

from .acquire import AcquiredThread, acquire_pasted_thread, acquire_thread
from .archive import archive_media_fetcher, fetch_cdn_media, read_tweets
from .detect import (
    COORDS_INVALID,
    COORDS_MISSING,
    POST_UNREADABLE,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    DetectedGeoloc,
    detect_diagnosed,
)
from .errors import (
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
)
from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
    extract_coords,
)
from .records import ParsedMedia, TweetRecord
from .stitch import stitch
from .syndication import fetch_syndication
from .urls import is_trusted_media_url, normalise_tweet_url

__all__ = [
    "COORDS_INVALID",
    "COORDS_MISSING",
    "POST_UNREADABLE",
    "SEVERAL_COORDINATES",
    "SOURCE_AMBIGUOUS",
    "SOURCE_MISSING",
    "AcquiredThread",
    "DetectedGeoloc",
    "InvalidTweetUrl",
    "ParsedCoord",
    "ParsedMedia",
    "TweetFetchFailed",
    "TweetNotAccessible",
    "TweetRecord",
    "TweetUpstreamBusy",
    "acquire_pasted_thread",
    "acquire_thread",
    "archive_media_fetcher",
    "clean_proof_text",
    "derive_title",
    "detect_diagnosed",
    "extract_coords",
    "fetch_cdn_media",
    "fetch_syndication",
    "is_trusted_media_url",
    "normalise_tweet_url",
    "read_tweets",
    "stitch",
]
