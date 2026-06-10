import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Per-field caps: generous enough not to count characters, tight enough to keep
# payload size predictable. The bio cap matches the "short blurb, not a post" intent.
BIO_MAX_LEN = 500
URL_MAX_LEN = 500
HANDLE_MAX_LEN = 200


def _normalise_optional(value: str | None, *, max_len: int, field: str) -> str | None:
    """Strip whitespace, coerce empty → None, enforce a length cap.

    Empty-after-strip becomes ``None`` on purpose: clearing a bio or link sends
    ``""`` from the browser, which must mean "clear", not "store an empty string".
    """
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
    # http(s) only. Blocks ``javascript:`` URLs (the XSS class auto-wrapping a
    # free-form string in ``<a href>`` would introduce) and anything exotic.
    if not (lowered.startswith("https://") or lowered.startswith("http://")):
        raise ValueError(f"{field} must be an http or https URL")
    return cleaned


class ExternalLinks(BaseModel):
    """Linktree-style external account links rendered on the profile.

    Stored as JSONB on ``users.external_links``. Each value is a free-form
    string (handle *or* URL — Discord/X handles often aren't URLs); the frontend
    decides whether to render it as a link by sniffing for an http scheme.
    """

    model_config = ConfigDict(extra="forbid")

    x: str | None = None
    discord: str | None = None
    website: str | None = None
    github: str | None = None

    @field_validator("x", "discord", "github")
    @classmethod
    def _handle(cls, v: str | None, info) -> str | None:
        return _normalise_optional(v, max_len=HANDLE_MAX_LEN, field=info.field_name)

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        return _normalise_url(v, field="website")


class AuthorRef(BaseModel):
    """Compact author handle used wherever one payload references another.

    The public ``User`` fields other schemas need for the byline + trust signal
    (geolocation card, bounty claimers, search hit). ``from_attributes=True``
    lets call sites assign a live SQLAlchemy row directly, no field-by-field build.
    """

    id: uuid.UUID
    username: str
    is_trusted: bool
    trust_reason: str | None

    model_config = ConfigDict(from_attributes=True)


class UserRead(BaseModel):
    """Authenticated-self payload for ``/auth/me`` and register/login.

    Everything the frontend needs to render the session's own profile + sidebar
    avatar without a second fetch. ``is_admin`` is deliberately absent — admin
    role lives on the dedicated ``/admin/me`` probe so it doesn't leak into the
    public OpenAPI schema.
    """

    id: uuid.UUID
    username: str
    email: str
    is_trusted: bool
    trust_reason: str | None
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    """Public profile payload for ``GET /users/{username}``.

    Excludes ``email`` (free-harvest vector) and ``is_admin`` (admin role is
    private). Everything else is the analyst's public face — bio, avatar, links,
    the credibility signal (``is_trusted`` + ``trust_reason``), submission count.
    """

    id: uuid.UUID
    username: str
    is_trusted: bool
    trust_reason: str | None
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime
    geolocations_count: int
    followers_count: int
    following_count: int
    is_following: bool = False

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    """Body for ``PATCH /users/me``.

    Every field optional with a sentinel default — the handler uses
    ``model_dump(exclude_unset=True)`` so "omitted" and "set to null" differ:
    omitted leaves the column alone, explicit null (or empty string) clears it.

    ``external_links`` is wholesale-replaced, not deep-merged: send the full
    desired object on any change. Matches how the edit form submits the whole
    panel at once.
    """

    model_config = ConfigDict(extra="forbid")

    bio: str | None = Field(default=None)
    avatar_url: str | None = Field(default=None)
    external_links: ExternalLinks | None = Field(default=None)

    @field_validator("bio")
    @classmethod
    def _bio(cls, v: str | None) -> str | None:
        return _normalise_optional(v, max_len=BIO_MAX_LEN, field="bio")

    @field_validator("avatar_url")
    @classmethod
    def _avatar(cls, v: str | None) -> str | None:
        return _normalise_url(v, field="avatar_url")
