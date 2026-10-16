import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.organization import OrganizationRole
from app.schemas.admin import normalize_x_handle
from app.schemas.user import AuthorRef, UserUpdate

# Lowercase letters, digits and inner hyphens, 2 to 50 characters.
ORGANIZATION_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$")
ORGANIZATION_NAME_MAX_LEN = 100


class OrganizationRef(BaseModel):
    """Compact organization handle for a notification row."""

    slug: str
    name: str
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class OrganizationRead(BaseModel):
    """Public profile for ``GET /organizations/{slug}``.

    ``viewer_role`` is the caller's role, null for a non-member or an anonymous
    caller. ``viewer_invited`` is true while the caller holds a pending invite.
    ``viewer_can_manage`` is true for an org-admin or a site admin: it gates
    the profile edit and the member management on the page.
    """

    id: uuid.UUID
    slug: str
    name: str
    x_handle: str | None
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime
    member_count: int
    viewer_role: OrganizationRole | None = None
    viewer_invited: bool = False
    viewer_can_manage: bool = False


class AdminOrganizationRead(BaseModel):
    """One row of ``GET /admin/organizations``. ``admin_count`` 0 flags an
    organization left without a live org-admin."""

    slug: str
    name: str
    member_count: int
    admin_count: int
    created_at: datetime


class OrganizationMembershipRead(BaseModel):
    """One organization an analyst belongs to, for ``GET /users/{username}/organizations``."""

    organization: OrganizationRef
    role: OrganizationRole
    joined_at: datetime


class OrganizationMemberRead(BaseModel):
    """One member on the organization page, admins first."""

    user: AuthorRef
    role: OrganizationRole
    joined_at: datetime


class OrganizationInviteRead(BaseModel):
    """One pending invite, for the org-admin's list."""

    id: uuid.UUID
    user: AuthorRef
    invited_by: AuthorRef | None
    created_at: datetime


class OrganizationInviteCreate(BaseModel):
    """Body for ``POST /organizations/{slug}/invites``."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=50)


class OrganizationMemberUpdate(BaseModel):
    """Body for ``PATCH /organizations/{slug}/members/{username}``."""

    model_config = ConfigDict(extra="forbid")

    role: OrganizationRole


class OrganizationUpdate(UserUpdate):
    """Body for ``PATCH /organizations/{slug}``: the fields an org-admin edits,
    under the rules of ``PATCH /users/me``. ``name``, ``slug`` and ``x_handle``
    stay with the site admin."""


class OrganizationCreate(OrganizationUpdate):
    """Body for ``POST /admin/organizations``.

    ``admin_username`` names the first org-admin, who joins at once without an
    invite.
    """

    name: str = Field(min_length=1, max_length=ORGANIZATION_NAME_MAX_LEN)
    slug: str
    x_handle: str | None = None
    admin_username: str = Field(min_length=1, max_length=50)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not ORGANIZATION_SLUG_PATTERN.fullmatch(cleaned):
            raise ValueError("slug must be 2 to 50 lowercase letters, digits or inner hyphens")
        return cleaned

    @field_validator("x_handle")
    @classmethod
    def _x_handle(cls, v: str | None) -> str | None:
        return normalize_x_handle(v)
