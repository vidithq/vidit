"""Tweet ingestion: acquire a tweet / thread, extract structured data.

* ``urls``: post URL parsing and writing, host predicates (pure string work).
* ``records``: the normalized, source-agnostic acquire units.
* ``extract``: pure text core (coordinates, title, proof body).
* ``stitch``: recombine records into threads.
* ``resolve``: the engine, threads to one ``Detection`` per coordinate, plus the
  refusal reason and any ``RequestDraft``.
* ``syndication``: X I/O (fetch, token, cache, payload mappers).
* ``chase``: the one fetch a thread's declared source costs, one module per
  technology behind a dispatcher.
* ``acquire``: the live acquisition the bot and the paste both resolve.
* ``archive``: the export reader (pure disk) and the CDN media fetchers.
* ``retry``: the retry schedule every outgoing fetch shares.

The pure modules (``records``, ``extract``, ``stitch``, ``resolve``) read no I/O
module (``tests/test_ingest_boundaries.py``). ``errors`` is a leaf module.
Callers import from this package.
"""

from __future__ import annotations

from .acquire import (
    AcquiredThread,
    acquire_from_post,
    acquire_pasted_thread,
    acquire_thread,
    read_pasted_post,
    record_by_id,
)
from .archive import archive_media_fetcher, fetch_cdn_media, read_tweets
from .chase import chase_thread
from .errors import (
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetImportError,
    TweetNotAccessible,
    TweetUpstreamBusy,
)
from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
    extract_coords,
    tags_bot,
)
from .records import ParsedMedia, TweetRecord
from .resolve import (
    COORDS_INVALID,
    COORDS_MISSING,
    DUPLICATE_MEDIA,
    FOOTAGE_UNUSABLE,
    POST_UNREADABLE,
    REFUSAL_MESSAGES,
    REQUEST_NOT_POSSIBLE,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    WARNING_MESSAGES,
    Detection,
    RequestDraft,
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
    "FOOTAGE_UNUSABLE",
    "POST_UNREADABLE",
    "REFUSAL_MESSAGES",
    "REQUEST_NOT_POSSIBLE",
    "SEVERAL_COORDINATES",
    "SOURCE_AMBIGUOUS",
    "SOURCE_DATE_UNKNOWN",
    "SOURCE_FETCH_FAILED",
    "SOURCE_FOOTAGE_MISSING",
    "SOURCE_MISSING",
    "WARNING_MESSAGES",
    "AcquiredThread",
    "Detection",
    "InvalidTweetUrl",
    "ParsedCoord",
    "ParsedMedia",
    "RequestDraft",
    "Resolution",
    "TweetFetchFailed",
    "TweetImportError",
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
    "record_by_id",
    "resolve_threads",
    "sole_refusal",
    "stitch",
    "tags_bot",
]
