"""Tweet ingestion — acquire a tweet / thread, extract structured data.

Single-responsibility bricks behind one import surface:

* ``extract`` — pure text core (coordinates, title, proof body), reused by
  every path.
* ``syndication`` — X I/O (URL normalisation, fetch + token + cache, schema
  mappers).
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

from .detect import DetectedGeoloc, detect
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
    TWITTER_MEDIA_HOSTS,
    NormalisedTweetUrl,
    ParsedMedia,
    ParsedQuotedTweet,
    fetch_syndication,
    is_trusted_media_url,
    normalise_tweet_url,
)

__all__ = [
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
    "clean_proof_text",
    "derive_title",
    "detect",
    "extract_coords",
    "fetch_syndication",
    "is_trusted_media_url",
    "normalise_tweet_url",
    "parse_tweet",
    "stitch",
]
