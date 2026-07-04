import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

InviteCodeStatus = Literal["active", "exhausted", "revoked", "expired"]


class AdminInviteCodeCreate(BaseModel):
    """Body for `POST /admin/invite-codes`.

    The service hardcodes ``max_uses=1`` so each code maps to exactly one
    analyst and the audit trail (`used_by`, `used_at`) is unambiguous. The
    `invite_codes.max_uses INT` column stays for forward-compat with bulk
    invites, but the API doesn't expose it today.
    """

    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class AdminInviteCodeRead(BaseModel):
    """Response shape for the admin invite-code list + create endpoints.

    ``status`` is computed at read time from the columns, never persisted, so it
    reflects current reality (an expired code stops showing active the moment
    ``expires_at`` passes, no bookkeeping job needed).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    max_uses: int
    use_count: int
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    status: InviteCodeStatus
    # Username of the *first* consumer, if any. For single-use codes (the
    # default) it's the only one; multi-use codes still surface only the first
    # — a full per-use audit would need an `invite_code_uses` junction table.
    used_by_username: str | None
    used_at: datetime | None


class AdminMeResponse(BaseModel):
    """Tiny response for the frontend route guard.

    Separate from `UserRead` on purpose: a public ``is_admin`` field on
    `/auth/me` would leak the admin role to the public schema (and to anyone
    scraping the OpenAPI spec). The guard only needs a 200/403 signal.
    """

    is_admin: bool


class AdminUserRead(BaseModel):
    """User shape returned by the admin search endpoint.

    Carries the bits the admin acts on (`is_trusted` + `trust_reason`) plus
    `email` (NULL for an assembled profile not yet claimed), which the public
    `UserProfile` omits.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str | None
    is_admin: bool
    is_trusted: bool
    trust_reason: str | None
    created_at: datetime


class AdminUserDeleteResponse(BaseModel):
    """Response for `DELETE /admin/users/{id}`.

    Carries the cascade summary so the admin sees what was swept — a sanity
    check and a copy-pasteable record of an irreversible action.
    """

    user_id: uuid.UUID
    username: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    # A request is a ``requested`` event since the merge, so a single event
    # cascade covers both located and requested rows — one count, no separate
    # request tally. ``media_count`` covers every file (source and proof roles).
    cascaded_geolocations: int = 0
    media_count: int = 0


class AdminEventDeleteResponse(BaseModel):
    """Response for `DELETE /admin/events/{id}`.

    Confirms what happened (which row, soft vs hard, what was swept) without a
    client re-query.
    """

    geolocation_id: uuid.UUID
    title: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    # Every file swept, source and proof roles alike.
    media_count: int = 0


class AdminTrustUpdate(BaseModel):
    """Body for `PATCH /admin/users/{id}/trust`.

    On grant, ``trust_reason`` is mandatory at the app layer (a checkmark with
    no public rationale is opaque favouritism). On revoke, the API ignores any
    body reason and clears the column server-side — a populated ``trust_reason``
    on a non-trusted row would be a stale-data bug.
    """

    is_trusted: bool
    trust_reason: str | None = None

    @field_validator("trust_reason")
    @classmethod
    def _strip_reason(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class AdminSeedDemoRequest(BaseModel):
    """Body for `POST /admin/seed-demo`.

    Capped at 50 000 per click. The seeder commits in batches so memory stays
    bounded; large seeds take time (~1 min per 10 k locally) but don't blow up.
    Re-running is additive on geos and idempotent on the demo authors.
    """

    count: int = Field(default=100, ge=1, le=50000)


class AdminSeedDemoResponse(BaseModel):
    created: int
    templates: int
    authors: int


class AdminWipeDemoResponse(BaseModel):
    deleted_geos: int
    deleted_users: int


class AdminSeedDemoRequestsRequest(BaseModel):
    """Body for ``POST /admin/seed-demo-requests``.

    Capped lower than the geolocation seeder: requests are an inbox, not a
    catalog, and 5000 covers the queue UI.
    """

    count: int = Field(default=20, ge=1, le=5000)


class AdminSeedDemoRequestsResponse(BaseModel):
    created: int
    templates: int
    authors: int
    with_claims: int
    # Per-status breakdown — mirrors the lifecycle the seeder spreads across
    # and proves the status-filter chips have data to render.
    open: int
    fulfilled: int
    closed: int


class AdminWipeDemoRequestsResponse(BaseModel):
    deleted_requests: int


class AdminMaintenanceResponse(BaseModel):
    """Single shape for both reaper endpoints.

    Every key is optional so one schema serves both reapers; the UI renders
    only the keys present in the response.
    """

    expired: int | None = None
    old_consumed: int | None = None
    pending_registrations_deleted: int | None = None
