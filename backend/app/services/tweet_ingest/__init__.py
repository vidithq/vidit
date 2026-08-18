"""Tweet ingestion: acquire a tweet / thread, extract structured data.

Single-responsibility bricks behind one import surface:

* ``urls``: the URL vocabulary (read a post URL to its id, write one back,
  the host predicates), pure string work.
* ``records``: the normalized acquire units (``TweetRecord``, ``ChasedPost``,
  ``ParsedMedia``), source-agnostic.
* ``extract``: pure text core (coordinates, title, proof body), reused by
  every path.
* ``stitch``: recombine records into threads (union-find on reply edges).
* ``resolve``: the engine, threads to one ``Draft`` per coordinate plus the
  reason a thread produced none.
* ``syndication``: X I/O (fetch + token + cache, payload mappers).
* ``chase``: the one chase step (``chase_thread``), one module per technology
  behind one dispatcher, for the single fetch a thread's declared source costs.
* ``acquire``: the live acquisition, a tweet id plus the same author's post it
  replies to, which is the thread the bot and the paste both resolve.
* ``archive``: the export reader (pure disk), plus the CDN media fetchers.

The four pure modules (``records``, ``extract``, ``stitch``, ``resolve``) read
no I/O module, which ``tests/test_ingest_boundaries.py`` states. Callers import
the public surface from this package; the module layout is an internal detail.
``errors`` is a leaf module so any brick can raise the shared failures without a
cycle.
"""

from __future__ import annotations

from .acquire import (
    AcquiredThread,
    acquire_from_post,
    acquire_pasted_thread,
    acquire_thread,
    read_pasted_post,
)
from .archive import archive_media_fetcher, fetch_cdn_media, read_tweets
from .chase import chase_thread
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
from .resolve import (
    COORDS_INVALID,
    COORDS_MISSING,
    DUPLICATE_MEDIA,
    POST_UNREADABLE,
    REFUSAL_MESSAGES,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    WARNING_MESSAGES,
    Draft,
    Resolution,
    resolve_threads,
    sole_refusal,
)
from .stitch import stitch
from .urls import is_trusted_media_url, normalise_tweet_url

__all__ = [
    "COORDS_INVALID",
    "COORDS_MISSING",
    "DUPLICATE_MEDIA",
    "POST_UNREADABLE",
    "REFUSAL_MESSAGES",
    "SEVERAL_COORDINATES",
    "SOURCE_AMBIGUOUS",
    "SOURCE_DATE_UNKNOWN",
    "SOURCE_FOOTAGE_MISSING",
    "SOURCE_MISSING",
    "WARNING_MESSAGES",
    "AcquiredThread",
    "Draft",
    "InvalidTweetUrl",
    "ParsedCoord",
    "ParsedMedia",
    "Resolution",
    "TweetFetchFailed",
    "TweetNotAccessible",
    "TweetRecord",
    "TweetUpstreamBusy",
    "acquire_from_post",
    "acquire_pasted_thread",
    "acquire_thread",
    "archive_media_fetcher",
    "chase_thread",
    "clean_proof_text",
    "derive_title",
    "extract_coords",
    "fetch_cdn_media",
    "is_trusted_media_url",
    "normalise_tweet_url",
    "read_pasted_post",
    "read_tweets",
    "resolve_threads",
    "sole_refusal",
    "stitch",
]
