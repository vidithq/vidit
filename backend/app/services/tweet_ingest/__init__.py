"""Tweet ingestion — acquire a tweet / thread, extract structured data.

Single-responsibility bricks behind one import surface:

* ``extract`` — pure text core (coordinates, title, proof body), reused by
  every path.
* ``syndication`` — X I/O (URL normalisation, fetch + token + cache, schema
  mappers).
* ``telegram``: off-platform footage chase, a t.me post's public embed to its
  post date (+ media when served). Used by the archive chase.
* ``records`` — the normalized ``TweetRecord`` acquire unit, source-agnostic.
* ``stitch`` — recombine records into threads (union-find on reply edges).
* ``detect`` — the machine path: a thread → ``DetectedGeoloc`` DTOs.
* ``parse`` — the human pre-fill orchestration behind ``import-from-tweet``;
  sibling of ``detect``.

Callers import the public surface from this package; the module layout is an
internal detail. ``errors`` is a leaf module so any brick can raise the
shared failures without a cycle.
"""

from __future__ import annotations

from .acquire import record_from_syndication
from .archive import archive_media_fetcher, fetch_cdn_media, read_tweets
from .detect import (
    COORDS_AMBIGUOUS,
    COORDS_INVALID,
    COORDS_MISSING,
    MARKERS_INCOMPLETE,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    SOURCE_OWN,
    SOURCE_UNBOUND,
    TITLE_MISSING,
    DetectedGeoloc,
    detect,
    detect_relay,
    detect_structured,
    detect_structured_diagnosed,
    fetch_relay_parent,
)
from .errors import (
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetImportError,
    TweetNotAccessible,
)
from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
    extract_coords,
)
from .parse import ParsedTweet, parse_tweet
from .records import TweetRecord
from .stitch import stitch
from .syndication import (
    MEDIA_FETCH_MAX_BYTES,
    TWITTER_MEDIA_HOSTS,
    NormalisedTweetUrl,
    ParsedMedia,
    ParsedQuotedTweet,
    fetch_syndication,
    is_trusted_media_url,
    normalise_tweet_url,
)

__all__ = [
    "COORDS_AMBIGUOUS",
    "COORDS_INVALID",
    "COORDS_MISSING",
    "MARKERS_INCOMPLETE",
    "MEDIA_FETCH_MAX_BYTES",
    "SOURCE_AMBIGUOUS",
    "SOURCE_MISSING",
    "SOURCE_OWN",
    "SOURCE_UNBOUND",
    "TITLE_MISSING",
    "TWITTER_MEDIA_HOSTS",
    "DetectedGeoloc",
    "InvalidTweetUrl",
    "NormalisedTweetUrl",
    "ParsedCoord",
    "ParsedMedia",
    "ParsedQuotedTweet",
    "ParsedTweet",
    "TweetFetchFailed",
    "TweetImportError",
    "TweetNotAccessible",
    "TweetRecord",
    "archive_media_fetcher",
    "clean_proof_text",
    "derive_title",
    "detect",
    "detect_relay",
    "detect_structured",
    "detect_structured_diagnosed",
    "extract_coords",
    "fetch_cdn_media",
    "fetch_relay_parent",
    "fetch_syndication",
    "is_trusted_media_url",
    "normalise_tweet_url",
    "parse_tweet",
    "read_tweets",
    "record_from_syndication",
    "stitch",
]
