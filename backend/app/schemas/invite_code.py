import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.admin import InviteCodeStatus, XHandle


class SponsoredInviteCodeCreate(BaseModel):
    """Body for `POST /users/me/invite-codes`: the invitee's X handle, which
    the code binds. Same normalization as `POST /admin/invite-codes`."""

    model_config = ConfigDict(extra="forbid")

    x_handle: XHandle


class SponsoredInviteCodeRead(BaseModel):
    """One invite code the caller minted. ``link`` is the register URL on the
    app's public origin, with the code prefilled."""

    id: uuid.UUID
    code: str
    link: str
    x_handle: str
    status: InviteCodeStatus
    created_at: datetime
    used_at: datetime | None


class SponsoredInviteCodeList(BaseModel):
    """Response for `GET /users/me/invite-codes`: the caller's codes, newest
    first, and where the daily quota stands."""

    items: list[SponsoredInviteCodeRead]
    # The admin switch; false hides the mint control.
    minting_enabled: bool
    daily_limit: int
    minted_today: int
    # The next 00:00 UTC, when ``minted_today`` drops back to 0.
    resets_at: datetime
