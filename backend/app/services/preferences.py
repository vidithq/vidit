"""Per-analyst preferences: notification channel overrides and the display
document, resolved against the defaults.

A missing ``user_preferences`` row reads as the defaults. The row is created
on the first write. A stored value that no longer validates (a kind or palette
since removed) reads as its default.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.notification import NOTIFICATION_KINDS
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.schemas.preferences import (
    DISPLAY_DEFAULTS,
    DisplayPreferences,
    NotificationPreferenceRead,
    UserPreferencesRead,
    UserPreferencesUpdate,
)


def _effective_display(stored: dict[str, Any]) -> DisplayPreferences:
    effective = DISPLAY_DEFAULTS.model_dump()
    for key, value in stored.items():
        if key not in effective:
            continue
        try:
            DisplayPreferences.model_validate({**effective, key: value})
        except ValidationError:
            continue
        effective[key] = value
    return DisplayPreferences.model_validate(effective)


def _build_read(row: UserPreferences | None) -> UserPreferencesRead:
    overrides = row.notification_overrides if row is not None else {}
    notifications = []
    for kind, defaults in NOTIFICATION_KINDS.items():
        stored = overrides.get(kind, {})
        channels = {
            channel: stored[channel] if isinstance(stored.get(channel), bool) else default
            for channel, default in defaults.items()
        }
        notifications.append(
            NotificationPreferenceRead(kind=kind, channels=channels, defaults=dict(defaults))
        )
    return UserPreferencesRead(
        display=_effective_display(row.display if row is not None else {}),
        display_defaults=DISPLAY_DEFAULTS,
        notifications=notifications,
    )


def get_preferences(db: Session, *, user: User) -> UserPreferencesRead:
    return _build_read(db.get(UserPreferences, user.id))


def _locked_row(db: Session, user: User) -> UserPreferences:
    """The analyst's row, created if absent, locked for this transaction."""
    db.execute(insert(UserPreferences).values(user_id=user.id).on_conflict_do_nothing())
    return (
        db.query(UserPreferences)
        .filter(UserPreferences.user_id == user.id)
        .populate_existing()
        .with_for_update()
        .one()
    )


def update_preferences(
    db: Session, *, user: User, body: UserPreferencesUpdate
) -> UserPreferencesRead:
    """Apply a partial update. The caller commits.

    A display field sent as ``null`` clears the stored value. A channel set to
    its default drops the override, so only differences are stored.
    """
    row = _locked_row(db, user)

    if body.display is not None:
        display = dict(row.display)
        for key, value in body.display.model_dump(exclude_unset=True).items():
            if value is None:
                display.pop(key, None)
            else:
                display[key] = value
        row.display = display

    if body.notifications is not None:
        overrides = {kind: dict(channels) for kind, channels in row.notification_overrides.items()}
        for kind, channels in body.notifications.items():
            kind_overrides = overrides.get(kind, {})
            for channel, value in channels.items():
                if value == NOTIFICATION_KINDS[kind][channel]:
                    kind_overrides.pop(channel, None)
                else:
                    kind_overrides[channel] = value
            if kind_overrides:
                overrides[kind] = kind_overrides
            else:
                overrides.pop(kind, None)
        row.notification_overrides = overrides

    return _build_read(row)
