"""Per-analyst preferences: notification channel overrides and the display
document, resolved against the defaults.

A missing ``user_preferences`` row reads as the defaults. The row is created
on the first write. A stored value that no longer validates (a kind or palette
since removed) reads as its default.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.notification import NOTIFICATION_KINDS, NotificationChannel, NotificationKind
from app.models.user import User
from app.models.user_preferences import REVIEW_REQUEST_AUDIENCE_DEFAULT, UserPreferences
from app.schemas.preferences import (
    DISPLAY_DEFAULTS,
    DisplayPreferences,
    DisplayPreferencesUpdate,
    NotificationPreferenceRead,
    UserPreferencesRead,
    UserPreferencesUpdate,
)
from app.services import product_update_consent


def _valid_stored_display(stored: dict[str, Any]) -> dict[str, Any]:
    defaults = DISPLAY_DEFAULTS.model_dump()
    valid = {}
    for key, value in stored.items():
        if key not in defaults:
            continue
        try:
            DisplayPreferences.model_validate({**defaults, key: value})
        except ValidationError:
            continue
        valid[key] = value
    return valid


def _effective_channels(
    row: UserPreferences | None, kind: NotificationKind
) -> dict[NotificationChannel, bool]:
    stored = (row.notification_overrides if row is not None else {}).get(kind, {})
    return {
        channel: stored[channel] if isinstance(stored.get(channel), bool) else default
        for channel, default in NOTIFICATION_KINDS[kind].items()
    }


def channel_enabled(
    db: Session, *, user_id: uuid.UUID, kind: NotificationKind, channel: NotificationChannel
) -> bool:
    """Whether ``user_id`` gets ``kind`` on ``channel``: their override, else the default."""
    return _effective_channels(db.get(UserPreferences, user_id), kind)[channel]


def _build_read(row: UserPreferences | None, *, product_updates: bool) -> UserPreferencesRead:
    notifications = [
        NotificationPreferenceRead(
            kind=kind, channels=_effective_channels(row, kind), defaults=dict(defaults)
        )
        for kind, defaults in NOTIFICATION_KINDS.items()
    ]
    stored_display = _valid_stored_display(row.display if row is not None else {})
    return UserPreferencesRead(
        display=DisplayPreferences.model_validate(
            {**DISPLAY_DEFAULTS.model_dump(), **stored_display}
        ),
        display_defaults=DISPLAY_DEFAULTS,
        display_stored=DisplayPreferencesUpdate.model_validate(stored_display),
        notifications=notifications,
        product_updates=product_updates,
        review_request_audience=(
            row.review_request_audience if row is not None else REVIEW_REQUEST_AUDIENCE_DEFAULT
        ),
    )


def get_preferences(db: Session, *, user: User) -> UserPreferencesRead:
    return _build_read(
        db.get(UserPreferences, user.id),
        product_updates=product_update_consent.has_consent(db, user.id),
    )


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

    if body.review_request_audience is not None:
        row.review_request_audience = body.review_request_audience

    if body.product_updates is True:
        product_update_consent.grant(db, user_id=user.id, source="settings", at=datetime.now(UTC))
    elif body.product_updates is False:
        product_update_consent.withdraw(db, user_id=user.id)

    return _build_read(row, product_updates=product_update_consent.has_consent(db, user.id))
