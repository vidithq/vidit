"""Tweet ingestion. Callers import from this package; ``docs/ingestion.md`` maps its modules."""

from __future__ import annotations

from .acquire import (
    AcquiredThread,
    acquire_from_post,
    acquire_thread,
    read_pasted_post,
    record_by_id,
)
from .archive import archive_media_fetcher, download_cdn_media, fetch_cdn_media, read_tweets
from .chase import chase_post, chase_thread
from .errors import (
    InvalidTweetUrl,
    MediaTooLarge,
    TweetFetchFailed,
    TweetImportError,
    TweetNotAccessible,
    TweetUpstreamBusy,
)
from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
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
    THREAD_TRUNCATED,
    WARNING_MESSAGES,
    Detection,
    RequestDraft,
    Resolution,
    resolve_threads,
    sole_refusal,
)
from .stitch import stitch
from .urls import is_importable_link, is_trusted_media_url, normalise_tweet_url

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
    "THREAD_TRUNCATED",
    "WARNING_MESSAGES",
    "AcquiredThread",
    "Detection",
    "InvalidTweetUrl",
    "MediaTooLarge",
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
    "acquire_thread",
    "archive_media_fetcher",
    "chase_post",
    "chase_thread",
    "clean_proof_text",
    "derive_title",
    "download_cdn_media",
    "fetch_cdn_media",
    "is_importable_link",
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
