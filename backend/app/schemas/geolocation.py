import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class _OriginatedFromBountyNested(BaseModel):
    """Compact bounty trace surfaced on the geolocation detail.

    Enough to render "originally posted as a bounty by @x" with a click-through;
    the full bounty row is one extra fetch when the reader wants it.
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
    # ``validated`` (human submits + bounty fulfilments) vs ``detected``
    # (machine-produced, rendered marked). See ``models.geolocation.STATE_*``.
    state: str
    # The post a machine detection was imported from — a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None = None
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
    # See ``GeolocationRead.state`` — a list card marks ``detected`` too.
    state: str
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

    Just the bits the analyst needs to recognise "that's the same event" and
    decide whether to abandon their in-progress submission. The full detail page
    is one click away for the proof body / media.
    """

    id: uuid.UUID
    title: str
    lat: float
    lng: float
    event_date: date
    source_url: str
    # Geodesic distance in metres from the caller-supplied (lat, lng). Float
    # (not int) so the frontend renders "120 m" vs "0.4 km" without rounding
    # artefacts at small distances.
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
