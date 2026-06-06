import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class _OriginatedFromBountyNested(BaseModel):
    """Compact bounty trace surfaced on the geolocation detail.

    Just enough to render "originally posted as a bounty by @x" with a
    click-through link; the full bounty row is one extra fetch on the
    detail page when the reader wants it.
    """

    id: uuid.UUID
    title: str
    author: AuthorRef

    model_config = {"from_attributes": True}


class GeolocationRead(BaseModel):
    id: uuid.UUID
    title: str
    lat: float
    lng: float
    source_url: str
    proof: dict[str, Any] | None
    event_date: date
    created_at: datetime
    updated_at: datetime
    is_demo: bool
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    originated_from_bounty: _OriginatedFromBountyNested | None = None

    model_config = {"from_attributes": True}


class GeolocationList(BaseModel):
    id: uuid.UUID
    title: str
    lat: float
    lng: float
    event_date: date
    is_demo: bool
    author: AuthorRef
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class PaginatedGeolocations(BaseModel):
    items: list[GeolocationList]
    total: int
    page: int
    per_page: int


class PossibleDuplicateRead(BaseModel):
    """Soft-warning hit on the submit form's possible-duplicate probe.

    Compact shape — just the bits the analyst needs to recognise
    "yeah, that's the same event" and decide whether to abandon their
    in-progress submission. The full detail page is one click away if
    they want the proof body / media.
    """

    id: uuid.UUID
    title: str
    lat: float
    lng: float
    event_date: date
    source_url: str
    # Geodesic distance in metres from the caller-supplied (lat, lng).
    # Float (not int) so the frontend can render "120 m" vs "0.4 km"
    # at small distances without rounding artefacts.
    distance_m: float
    author: AuthorRef

    model_config = {"from_attributes": True}


class TweetImportRequest(BaseModel):
    """Body of ``POST /geolocations/import-from-tweet``."""

    url: str = Field(..., min_length=1, max_length=2048)


class TweetImportCoord(BaseModel):
    lat: float
    lng: float


class TweetImportMedia(BaseModel):
    kind: Literal["image", "video"]
    # ``remote_url`` is the upstream X CDN URL the frontend either
    # fetches directly (when CORS permits — usually it doesn't) or
    # proxies via ``GET /geolocations/import-from-tweet/media``.
    remote_url: str
    content_type: str
    # Where the media came from inside the OP/quote pair. Informational
    # only — the primary-vs-proof split on the frontend is by ``kind``
    # (videos → primary, images → proof), see api.md.
    origin: Literal["op", "quote"] = "op"


class TweetImportQuotedTweet(BaseModel):
    """The tweet quoted by the OP, when present.

    Surfaced so the frontend can credit the original author in the
    proof body even though the geolocation's ``source_url`` already
    points at this quoted tweet.
    """

    source_url: str
    author_handle: str
    tweet_text: str


class TweetImportResponse(BaseModel):
    """Pre-fill payload for the submit form.

    All fields are best-effort. ``suggested_title`` is empty when the
    tweet text yields nothing usable; ``parsed_coords`` is empty when
    the text carries no recognised coordinate format; ``media`` is
    empty when the tweet has no attached image / video. The analyst
    reviews everything before clicking submit — this is a typing
    shortcut, not an authority on the event.

    When the OP quote-retweets, ``source_url`` is the quoted tweet's
    URL (the OSINT-correct attribution); ``original_tweet_url`` is
    always the OP's URL and ``quoted_tweet`` carries the quote's
    metadata so the frontend can render both in the proof body.
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
