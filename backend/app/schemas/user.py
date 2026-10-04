import re
import uuid
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Per-field caps: generous but keeping payloads predictable. Mirrors
# ``frontend/src/components/profile/useProfileEdit.ts::BIO_MAX_LEN``.
BIO_MAX_LEN = 500
URL_MAX_LEN = 500
HANDLE_MAX_LEN = 200


def _normalise_optional(value: str | None, *, max_len: int, field: str) -> str | None:
    """Strip whitespace, coerce empty → None, enforce a length cap. Empty means
    "clear", not "store an empty string"."""
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        raise ValueError(f"{field} must be {max_len} characters or fewer")
    return cleaned


def _normalise_url(value: str | None, *, field: str) -> str | None:
    cleaned = _normalise_optional(value, max_len=URL_MAX_LEN, field=field)
    if cleaned is None:
        return None
    lowered = cleaned.lower()
    # http(s) only: blocks ``javascript:`` URLs.
    if not (lowered.startswith("https://") or lowered.startswith("http://")):
        raise ValueError(f"{field} must be an http or https URL")
    return cleaned


# The platform rules, mirrored by ``frontend/src/lib/users.ts`` (``SOCIAL_HOSTS``
# + ``SOCIAL_HANDLE_PATTERN``; change both). Canonical host first: a stored
# handle expands to it when linked.
SOCIAL_PROFILE_HOSTS: dict[str, tuple[str, ...]] = {
    "x": ("x.com", "twitter.com"),
    "github": ("github.com",),
}

# Each platform's account-name rule. ``discord`` has no profile URL, so it is
# absent from the host map.
SOCIAL_HANDLE_PATTERNS: dict[str, re.Pattern[str]] = {
    "x": re.compile(r"^[A-Za-z0-9_]{1,15}$"),
    "github": re.compile(r"^[A-Za-z0-9-]{1,39}$"),
    # Trailing group: the legacy discriminator (``ana#1234``).
    "discord": re.compile(r"^[A-Za-z0-9_.]{2,32}(#[0-9]{4})?$"),
}


def _url_path_handle(value: str, hosts: tuple[str, ...]) -> str | None:
    """The one path segment of a profile URL on ``hosts``, or ``None``.

    Rejects queries, fragments and multi-segment paths, so a status URL or
    product path never passes as an account name.
    """
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https"):
        return None
    if parts.query or parts.fragment:
        return None
    host = parts.hostname or ""
    if host.removeprefix("www.") not in hosts:
        return None
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) != 1:
        return None
    return segments[0].removeprefix("@")


def _normalise_handle(value: str | None, *, field: str) -> str | None:
    """Validate one account name and store the bare handle.

    ``x`` and ``github`` take a handle (``ana``, ``@ana``) or a profile URL on
    the platform's hosts; ``discord`` takes a username only (no profile URL).
    """
    cleaned = _normalise_optional(value, max_len=HANDLE_MAX_LEN, field=field)
    if cleaned is None:
        return None

    hosts = SOCIAL_PROFILE_HOSTS.get(field)
    if hosts is None:
        if cleaned.lower().startswith("http") or set("/:") & set(cleaned):
            raise ValueError(f"{field} must be a username, not a link")
        handle = cleaned.removeprefix("@")
    elif cleaned.lower().startswith(("http://", "https://")):
        from_url = _url_path_handle(cleaned, hosts)
        if from_url is None:
            raise ValueError(f"{field} must be a handle or a profile URL on {hosts[0]}")
        handle = from_url
    else:
        handle = cleaned.removeprefix("@")

    if not SOCIAL_HANDLE_PATTERNS[field].match(handle):
        if hosts is None:
            raise ValueError(f"{field} must be a Discord username")
        raise ValueError(f"{field} must be a handle or a profile URL on {hosts[0]}")
    return handle


class ExternalLinks(BaseModel):
    """Linktree-style external account links rendered on the profile
    (``users.external_links`` JSONB).

    ``x`` and ``github`` take a handle or profile URL on
    :data:`SOCIAL_PROFILE_HOSTS` and store the bare handle (rules in
    :data:`SOCIAL_HANDLE_PATTERNS`), ``discord`` a username, ``website`` an
    http(s) URL; anything else raises.
    """

    model_config = ConfigDict(extra="forbid")

    x: str | None = None
    discord: str | None = None
    website: str | None = None
    github: str | None = None

    @field_validator("x", "discord", "github")
    @classmethod
    def _handle(cls, v: str | None, info) -> str | None:
        return _normalise_handle(v, field=info.field_name)

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        return _normalise_url(v, field="website")


class AuthorRef(BaseModel):
    """Compact author handle for bylines (geolocation card, geolocator credit,
    search hit). ``from_attributes`` lets call sites assign a SQLAlchemy row
    directly."""

    id: uuid.UUID
    username: str
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserRead(BaseModel):
    """Authenticated-self payload for ``/auth/me`` and register/login.

    ``is_admin`` is absent so the role stays off the public OpenAPI schema
    (``/admin/me`` is the probe).
    """

    id: uuid.UUID
    username: str
    email: str
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    """Public profile payload for ``GET /users/{username}``.

    Excludes ``email`` and ``is_admin``. ``geolocations_count`` counts
    published geolocations, the set ``GET /users/{username}/events`` serves;
    ``total_events`` on :class:`UserStatsRead` includes detections.
    """

    id: uuid.UUID
    username: str
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime
    geolocations_count: int
    followers_count: int
    following_count: int
    is_following: bool = False

    model_config = ConfigDict(from_attributes=True)


class TagCount(BaseModel):
    """One (name, count) entry for a conflict, capture-source or source-host tally."""

    name: str
    count: int


class ActivityBucket(BaseModel):
    """One month of the activity grid: ``period`` is ``YYYY-MM``."""

    period: str
    count: int


class UserStatsRead(BaseModel):
    """Aggregated shape-of-work payload for ``GET /users/{username}/stats``.

    One population: the analyst's live events (``deleted_at IS NULL``,
    ``hidden_at IS NULL``) in ``geolocated`` or ``detected``, which is
    ``total_events``; every other field describes it. ``requested`` and
    ``closed`` rows take part in no aggregate.

    ``source_hosts`` breaks the set down by ``source_url`` host (lowercased,
    leading ``www.`` removed): top hosts, with ``other_hosts_count`` the tail
    and ``no_source_count`` the events with no readable host. The three sum to
    ``total_events``.

    ``activity`` counts ``event_date`` per calendar month over the analyst's
    span, earliest first, zero-filled, empty when no event carries a date.
    """

    geolocated_count: int
    detected_count: int
    total_events: int
    media_count: int
    top_conflicts: list[TagCount]
    capture_sources: list[TagCount]
    source_hosts: list[TagCount]
    other_hosts_count: int
    no_source_count: int
    activity: list[ActivityBucket]


class UserUpdate(BaseModel):
    """Body for ``PATCH /users/me``.

    ``exclude_unset`` separates omitted (column untouched) from null or empty
    string (clears). ``external_links`` is wholesale-replaced, not deep-merged.

    ``avatar_url`` is absent on purpose (server-minted by ``PUT`` / ``DELETE
    /users/me/avatar``); ``extra="forbid"`` makes setting it a 422.
    """

    model_config = ConfigDict(extra="forbid")

    bio: str | None = Field(default=None)
    external_links: ExternalLinks | None = Field(default=None)

    @field_validator("bio")
    @classmethod
    def _bio(cls, v: str | None) -> str | None:
        return _normalise_optional(v, max_len=BIO_MAX_LEN, field="bio")
