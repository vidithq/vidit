from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.notification import NotificationChannel, NotificationKind
from app.models.user_preferences import ApprovalRequestAudience

# The display allowlists. The frontend derives its palette and theme ids from
# these through the generated API types; its swatch list, theme check and CSS
# are hand-kept mirrors (docs/engineering.md, Hand-kept mirrors).
PaletteId = Literal["orange", "blue", "emerald", "violet", "rose"]
ThemeId = Literal["dark", "light"]


class DisplayPreferences(BaseModel):
    palette: PaletteId
    theme: ThemeId
    help_tooltips: bool


# Mirrored by the frontend defaults in lib/palette.ts, lib/theme.ts and
# lib/helpPreference.ts; change both.
DISPLAY_DEFAULTS = DisplayPreferences(palette="orange", theme="dark", help_tooltips=True)


class DisplayPreferencesUpdate(BaseModel):
    """An omitted field is left as stored; ``null`` clears the stored value."""

    model_config = ConfigDict(extra="forbid")

    palette: PaletteId | None = None
    theme: ThemeId | None = None
    help_tooltips: bool | None = None


class NotificationPreferenceRead(BaseModel):
    kind: NotificationKind
    channels: dict[NotificationChannel, bool]
    defaults: dict[NotificationChannel, bool]


class UserPreferencesRead(BaseModel):
    """Effective values, each beside the default it falls back to.
    ``display_stored`` holds only the display values the account has saved
    (``null`` where it has none), so a client can tell a saved value from a
    default. ``notifications`` lists every registered kind in registry order.
    ``product_updates`` is whether a consent to product update emails is
    current; it has no default to fall back to, since consent is never
    presumed. ``approval_request_audience`` is who may send you a approval
    request."""

    display: DisplayPreferences
    display_defaults: DisplayPreferences
    display_stored: DisplayPreferencesUpdate
    notifications: list[NotificationPreferenceRead]
    product_updates: bool
    approval_request_audience: ApprovalRequestAudience


class UserPreferencesUpdate(BaseModel):
    """Body for ``PATCH /users/me/preferences``. Each ``notifications`` entry
    sets channels of one kind; a value equal to the default drops the
    override. ``product_updates`` grants or withdraws the consent to product
    update emails from Settings."""

    model_config = ConfigDict(extra="forbid")

    display: DisplayPreferencesUpdate | None = None
    notifications: dict[NotificationKind, dict[NotificationChannel, bool]] | None = None
    product_updates: bool | None = None
    approval_request_audience: ApprovalRequestAudience | None = None
