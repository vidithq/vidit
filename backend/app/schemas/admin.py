import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# X handle alphabet (letters, digits, underscore, 15 max), matched after
# normalization.
X_HANDLE_PATTERN = re.compile(r"^[a-z0-9_]{1,15}$")


def normalize_x_handle(v: str | None) -> str | None:
    """Shared validator for every ``x_handle`` intake: strip one leading ``@``,
    lowercase, enforce the alphabet. ``ValueError`` (a 422) on mismatch."""
    if v is None:
        return None
    cleaned = v.strip().removeprefix("@").lower()
    if not X_HANDLE_PATTERN.fullmatch(cleaned):
        raise ValueError("x_handle must match ^[a-z0-9_]{1,15}$ after stripping a leading @")
    return cleaned


InviteCodeStatus = Literal["active", "exhausted", "revoked", "expired"]


class AdminInviteCodeCreate(BaseModel):
    """Body for `POST /admin/invite-codes`.

    Every code is single-use, so the audit trail (`used_by`, `used_at`) is
    unambiguous. ``x_handle`` optionally binds the code to an X handle that
    redemption copies onto the new account (same normalization as
    `PATCH /admin/users/{id}/x-handle`).
    """

    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    x_handle: str | None = None

    @field_validator("x_handle")
    @classmethod
    def _normalize_handle(cls, v: str | None) -> str | None:
        return normalize_x_handle(v)


class AdminInviteRedeemerRead(BaseModel):
    """Onboarding snapshot of the account a code was redeemed by.

    Nested in `AdminInviteCodeRead` so the onboarding table needs no request
    per row. Same acting fields as `AdminUserRead` plus counters.
    """

    user_id: uuid.UUID
    username: str
    email: str | None
    is_admin: bool
    x_handle: str | None
    # ``done`` archive-import jobs only.
    archives_imported: int
    # Sum of ``bot_mentions.events_created`` for the account's X handle.
    # Historical: a later-deleted detection still counted.
    bot_detection_count: int
    # Live detections they own. The purge endpoint also sweeps soft-deleted
    # ones, so it may remove more.
    detected_count: int
    # Live ``geolocated`` events they own.
    geolocated_count: int
    # Most recent authenticated request (``users.last_seen_at``), falling back
    # to the newest ``login`` auth event on rows predating it; NULL if neither.
    last_seen_at: datetime | None


class AdminInviteCodeRead(BaseModel):
    """Response shape for the admin invite-code list + create endpoints.

    ``status`` is computed at read time, never persisted, so an expired code
    stops showing active the moment ``expires_at`` passes.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    expires_at: datetime | None
    created_at: datetime
    status: InviteCodeStatus
    # The X handle the code binds.
    x_handle: str | None
    # NULL while unredeemed, and once that account is erased.
    redeemer: AdminInviteRedeemerRead | None
    used_at: datetime | None


class AdminMeResponse(BaseModel):
    """Tiny response for the frontend route guard.

    Separate from `UserRead` so ``is_admin`` doesn't leak to the public schema
    or the OpenAPI spec.
    """

    is_admin: bool


class AdminUserRead(BaseModel):
    """User shape returned by the admin search endpoint: the bot-attribution
    `x_handle` plus `email` (NULL on legacy rows), which `UserProfile` omits.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str | None
    is_admin: bool
    x_handle: str | None
    created_at: datetime


class AdminUserDeleteResponse(BaseModel):
    """Response for `DELETE /admin/users/{id}`, with the cascade summary as a
    record of an irreversible action."""

    user_id: uuid.UUID
    username: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    # One event cascade covers located and requested rows.
    cascaded_geolocations: int = 0
    # Storage objects swept across those events (source and proof, derivatives
    # included), so higher than an event delete's media-row count.
    media_count: int = 0


class AdminEventDeleteResponse(BaseModel):
    """Response for `DELETE /admin/events/{id}`: which row, soft vs hard, what
    was swept."""

    geolocation_id: uuid.UUID
    title: str
    mode: Literal["soft", "hard"]
    deleted_at: datetime | None = None
    # Media rows dropped (source and proof). Excludes the hero / thumb
    # derivatives the sweep also removes.
    media_count: int = 0


class AdminCollectionHideResponse(BaseModel):
    """Response for ``PATCH /admin/collections/{id}/moderation`` and its
    takedown alias ``DELETE /admin/collections/{id}``.

    ``hidden_at`` is the stamp now carried (the original on an already
    withheld collection, ``None`` once restored). Both verbs are idempotent.
    """

    collection_id: uuid.UUID
    title: str
    hidden_at: datetime | None


class AdminCollectionModerationUpdate(BaseModel):
    """Body for ``PATCH /admin/collections/{id}/moderation``.

    One axis, ``hidden``: a collection holds no footage, so it has no
    ``is_graphic`` like :class:`AdminEventModerationUpdate`.
    """

    hidden: bool


class AdminEventModerationUpdate(BaseModel):
    """Body for ``PATCH /admin/events/{id}/moderation``.

    Two independent optional axes: ``is_graphic`` overrides the author's
    declaration, ``hidden`` withholds or restores the event. ``None`` leaves
    that axis as is.
    """

    is_graphic: bool | None = None
    hidden: bool | None = None


class AdminEventModerationRead(BaseModel):
    """The moderation state of one event after the PATCH.

    Narrow on purpose: the full ``EventRead`` would make a toggle pay for the
    detail read's eager loads. ``hidden_at`` says when the takedown landed.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_graphic: bool
    hidden_at: datetime | None


class AdminPurgeDetectedResponse(BaseModel):
    """Response for `DELETE /admin/users/{id}/detected-events`: the
    broken-archive repair. Every detection the user owns is hard-deleted (rows
    + S3 media); the account is untouched."""

    user_id: uuid.UUID
    username: str
    deleted_events: int = 0
    # Storage objects swept (source and proof, derivatives included).
    media_count: int = 0


class UserXHandleUpdate(BaseModel):
    """Body for `PATCH /admin/users/{id}/x-handle`.

    ``None`` clears the link; a value is normalized and must match
    ``^[a-z0-9_]{1,15}$`` (else 422).
    """

    x_handle: str | None

    @field_validator("x_handle")
    @classmethod
    def _normalize_handle(cls, v: str | None) -> str | None:
        return normalize_x_handle(v)


class AdminMaintenanceResponse(BaseModel):
    """Single shape for every Maintenance-panel action; keys are optional and
    the UI renders those present."""

    expired: int | None = None
    old_consumed: int | None = None
    pending_registrations_deleted: int | None = None
    # Completion digest: analysts written to, detections covered, sends rejected.
    analysts_notified: int | None = None
    detections_pending: int | None = None
    digest_send_failures: int | None = None


class AdminDetectionStatsRead(BaseModel):
    """Quality signal on the machine-extraction pipeline (admin-only).

    A machine detection is a row imported from X and never a request:
    ``detected_from_url`` set and ``requested_at`` NULL. The second column
    keeps a bot-opened request out of the cohort for life, since the stamp is
    never cleared, even after a fulfiller geolocates it.

    Reject-rate: the fraction of machine detections dismissed before
    publication, either closed by an owner straight out of ``detected``
    (``status = 'closed'``, ``before_closed_status = 'detected'``) or
    soft-deleted by an admin while ``detected`` (``deleted_at IS NOT NULL``,
    ``status = 'detected'``). A vouched (``geolocated``) detection is not a
    reject even if soft-deleted later; one awaiting review is not a reject yet.
    Both reject shapes are ones ``services/detection._row_disposition`` refuses
    to re-import. ``reject_rate`` is ``machine_rejected / machine_total`` (0..1,
    0 when there are none), counted over all machine rows, soft-deleted or not.

    One accepted edge, favouring over-counting: an account-departure cascade
    soft-delete counts that account's pending detections as rejects.

    The ``pending_*`` counts profile the live ``detected`` queue (machine rows,
    ``deleted_at IS NULL``): how many miss a piece the geolocate floor demands,
    so a poor extraction run shows before an analyst opens the queue.
    """

    machine_total: int
    machine_rejected: int
    reject_rate: float
    pending: int
    pending_missing_source_media: int
    pending_missing_proof_image: int
    pending_missing_source_url: int
