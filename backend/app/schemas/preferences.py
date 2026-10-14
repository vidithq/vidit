from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.notification import NotificationChannel, NotificationKind

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
    ``notifications`` lists every registered kind in registry order."""

    display: DisplayPreferences
    display_defaults: DisplayPreferences
    notifications: list[NotificationPreferenceRead]


class UserPreferencesUpdate(BaseModel):
    """Body for ``PATCH /users/me/preferences``. Each ``notifications`` entry
    sets channels of one kind; a value equal to the default drops the
    override."""

    model_config = ConfigDict(extra="forbid")

    display: DisplayPreferencesUpdate | None = None
    notifications: dict[NotificationKind, dict[NotificationChannel, bool]] | None = None
