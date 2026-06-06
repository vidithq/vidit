import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

InviteCodeStatus = Literal["active", "exhausted", "revoked", "expired"]


class AdminInviteCodeCreate(BaseModel):
    """Body for `POST /admin/invite-codes`.

    The service hardcodes ``max_uses=1`` — the policy decision is "every code
    maps to exactly one analyst" so the audit trail (`used_by`, `used_at`) is
    unambiguous. The column on `invite_codes` keeps `max_uses INT` for
    forward-compat with a possible future bulk-invite feature, but the API
    surface doesn't expose it today.
    """

    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class AdminInviteCodeRead(BaseModel):
    """Response shape for the admin invite-code list + create endpoints.

    ``status`` is computed at read time from the underlying columns — it's
    never persisted, so a code's status reflects current reality (e.g. an
    expired code stops showing as active the moment ``expires_at`` passes,
    no bookkeeping job needed).
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
    # Username of the *first* analyst who consumed this code, if any. For
    # single-use codes (the closed-beta default) this is also the only
    # consumer. Multi-use codes still only surface the first one — a full
    # per-use audit would need an `invite_code_uses` junction table.
    used_by_username: str | None
    used_at: datetime | None


class AdminMeResponse(BaseModel):
    """Tiny response for the frontend route guard.

    Lives separately from `UserRead` on purpose: hitting `/auth/me` and
    branching on a public ``is_admin`` field would leak the admin role to
    the public schema (and to anyone scraping the OpenAPI spec). The guard
    only needs a 200/403 signal.
    """

    is_admin: bool


class AdminUserRead(BaseModel):
    """User shape returned by the admin search endpoint.

    Carries the bits the admin needs to decide whether to act on the row
    (`is_trusted` + `trust_reason`) plus identity (`email`) which is not
    on the public `UserProfile`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    is_admin: bool
    is_trusted: bool
    trust_reason: str | None
    created_at: datetime


class AdminUserDeleteResponse(BaseModel):
    """Response for `DELETE /admin/users/{id}`.

    Carries the cascade summary so the admin sees what was actually swept
    — useful both as a sanity check and as a copy-pasteable record of an
    irreversible action.
    """

    user_id: uuid.UUID
    username: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    cascaded_geolocations: int = 0
    cascaded_bounties: int = 0
    media_count: int = 0
    proof_image_count: int = 0


class AdminGeolocationDeleteResponse(BaseModel):
    """Response for `DELETE /admin/geolocations/{id}`.

    Carries enough to confirm to the admin what just happened (which row,
    soft vs hard, what was swept) without re-querying the DB on the client.
    """

    geolocation_id: uuid.UUID
    title: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    media_count: int = 0
    proof_image_count: int = 0


class AdminTrustUpdate(BaseModel):
    """Body for `PATCH /admin/users/{id}/trust`.

    When granting trust, ``trust_reason`` is mandatory at the application
    layer (a checkmark with no public-facing rationale is opaque
    favouritism, per the spec). When revoking, the API ignores any reason
    in the body and clears the column server-side — keeping ``trust_reason``
    populated on a non-trusted row would be a stale-data bug.
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

    Capped at 50 000 per click. The seeder commits in batches internally
    so memory stays bounded; large seeds take time (rough rule of thumb:
    ~1 minute per 10 k locally) but don't blow up. Re-running is additive
    on geos and idempotent on the demo authors, so split into multiple
    clicks if you'd rather keep each request short.
    """

    count: int = Field(default=100, ge=1, le=50000)


class AdminSeedDemoResponse(BaseModel):
    created: int
    templates: int
    authors: int


class AdminWipeDemoResponse(BaseModel):
    deleted_geos: int
    deleted_users: int


class AdminSeedDemoBountiesRequest(BaseModel):
    """Body for ``POST /admin/seed-demo-bounties``.

    Capped lower than the geolocation seeder — bounties are an inbox, not
    a catalog. 5000 is plenty for showing off the queue UI; if a demo
    needs more, click again.
    """

    count: int = Field(default=20, ge=1, le=5000)


class AdminSeedDemoBountiesResponse(BaseModel):
    created: int
    templates: int
    authors: int
    with_claims: int
    # Per-status breakdown so the admin can see the mix at a glance —
    # mirrors the lifecycle the seeder spreads across (open / fulfilled
    # / closed) and proves the status-filter chips have data to render.
    open: int
    fulfilled: int
    closed: int


class AdminWipeDemoBountiesResponse(BaseModel):
    deleted_bounties: int


class AdminMaintenanceResponse(BaseModel):
    """Single shape for both reaper endpoints.

    Different ops fill different fields — every key is optional so the
    same schema serves both reapers; the UI renders only the keys
    present in the response.
    """

    expired: int | None = None
    old_consumed: int | None = None
    rows_deleted: int | None = None
    s3_deleted: int | None = None
    s3_failed: int | None = None
    pending_registrations_deleted: int | None = None
