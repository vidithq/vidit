"""Tweet-import DTOs — the pre-fill payloads for ``import-from-tweet``.

The shapes the ``GET/POST /geolocations/import-from-tweet`` endpoints return: the
human pre-fill (``TweetImportResponse`` + its ``Coord`` / ``Media`` /
``QuotedTweet`` parts) and the no-persist machine ``DetectedGeolocPreview``. Kept
separate from the core geolocation read/write schemas in ``event.py`` —
they're a self-contained sub-feature, consumed only by the import router.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.models.media import MediaType


class TweetImportRequest(BaseModel):
    """Body of ``POST /geolocations/import-from-tweet``."""

    url: str = Field(..., min_length=1, max_length=2048)


class TweetImportCoord(BaseModel):
    lat: float
    lng: float


class TweetImportMedia(BaseModel):
    kind: MediaType
    # Upstream X CDN URL — the frontend fetches it directly when CORS permits
    # (usually it doesn't) or proxies via ``GET /geolocations/import-from-tweet/media``.
    remote_url: str
    content_type: str
    # Where the media came from in the OP/quote pair. Informational only — the
    # primary-vs-proof split is by ``kind`` (videos → primary, images → proof),
    # see api.md.
    origin: Literal["op", "quote"] = "op"


class TweetImportQuotedTweet(BaseModel):
    """The tweet quoted by the OP, when present.

    Surfaced so the frontend can credit the original author in the proof body
    even though ``source_url`` already points at this quoted tweet.
    """

    source_url: str
    author_handle: str
    tweet_text: str


class DetectedGeolocPreview(BaseModel):
    """One machine detection the pipeline would produce from a pasted tweet.

    The no-persist preview output (``import-from-tweet``): zero DB writes, the
    inspection window into the machine ``detect`` path. ``proof_text`` is the
    plain proof body the assemble step would wrap into the JSONB proof doc;
    ``detected_from_url`` is the originating post.
    """

    lat: float
    lng: float
    title: str
    proof_text: str
    detected_from_url: str
    event_date: date
    media: list[TweetImportMedia]


class TweetImportResponse(BaseModel):
    """Pre-fill payload for the submit form.

    All fields best-effort: ``suggested_title`` empty when the text yields
    nothing usable, ``parsed_coords`` empty when no recognised coordinate
    format, ``media`` empty when no attached image / video. The analyst reviews
    everything before submitting — a typing shortcut, not an authority.

    When the OP quote-retweets, ``source_url`` is the quoted tweet's URL (the
    OSINT-correct attribution), ``original_tweet_url`` is always the OP's, and
    ``quoted_tweet`` carries the quote's metadata so the frontend renders both.
    """

    source_url: str
    original_tweet_url: str
    posted_at: str  # ISO 8601 from X — frontend truncates to date for the form
    author_handle: str
    tweet_text: str
    suggested_title: str
    parsed_coords: list[TweetImportCoord]
    media: list[TweetImportMedia]
    quoted_tweet: TweetImportQuotedTweet | None = None
    # The machine path's view of the same tweet — the detections the pipeline
    # would produce, surfaced for inspection. Zero DB writes. Empty when no
    # coordinate parses.
    detected: list[DetectedGeolocPreview] = []
