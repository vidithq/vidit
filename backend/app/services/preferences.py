"""Per-analyst preferences: notification email overrides and the display
document, resolved against the defaults.

A missing ``user_preferences`` row reads as the defaults. The row is created
on the first write. A stored value that no longer validates (a kind or palette
since removed) reads as its default.
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.notification import NOTIFICATION_KINDS, NotificationKind
from app.models.user import User
from app.models.user_preferences import APPROVAL_REQUEST_AUDIENCE_DEFAULT, UserPreferences
from app.schemas.preferences import (
    DISPLAY_DEFAULTS,
    DisplayPreferences,
    DisplayPreferencesUpdate,
    NotificationPreferenceRead,
    UserPreferencesRead,
    UserPreferencesUpdate,
)
from app.services import unsubscribe_tokens
from app.services.unsubscribe_tokens import InvalidUnsubscribeTokenError

_EMAIL_UNSUBSCRIBE_PURPOSE = b"vidit:notification-email-unsubscribe:"


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


def _effective_email(row: UserPreferences | None, kind: NotificationKind) -> bool:
    stored = (row.notification_overrides if row is not None else {}).get(kind)
    return stored if isinstance(stored, bool) else NOTIFICATION_KINDS[kind]


def email_enabled(db: Session, *, user_id: uuid.UUID, kind: NotificationKind) -> bool:
    """Whether ``user_id`` gets ``kind`` by email: their override, else the default."""
    return _effective_email(db.get(UserPreferences, user_id), kind)


def _build_read(row: UserPreferences | None) -> UserPreferencesRead:
    notifications = [
        NotificationPreferenceRead(kind=kind, email=_effective_email(row, kind), default=default)
        for kind, default in NOTIFICATION_KINDS.items()
    ]
    stored_display = _valid_stored_display(row.display if row is not None else {})
    return UserPreferencesRead(
        display=DisplayPreferences.model_validate(
            {**DISPLAY_DEFAULTS.model_dump(), **stored_display}
        ),
        display_defaults=DISPLAY_DEFAULTS,
        display_stored=DisplayPreferencesUpdate.model_validate(stored_display),
        notifications=notifications,
        approval_request_audience=(
            row.approval_request_audience if row is not None else APPROVAL_REQUEST_AUDIENCE_DEFAULT
        ),
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

    A display field sent as ``null`` clears the stored value. An email switch
    set to its default drops the override, so only differences are stored.
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
        overrides = dict(row.notification_overrides)
        for kind, value in body.notifications.items():
            if value == NOTIFICATION_KINDS[kind]:
                overrides.pop(kind, None)
            else:
                overrides[kind] = value
        row.notification_overrides = overrides

    if body.approval_request_audience is not None:
        row.approval_request_audience = body.approval_request_audience

    return _build_read(row)


def email_unsubscribe_token(user_id: uuid.UUID, kind: NotificationKind) -> str:
    """A token that turns off ``kind`` by email for ``user_id``: the one-click
    ``List-Unsubscribe`` of a notification email."""
    return unsubscribe_tokens.sign(_EMAIL_UNSUBSCRIBE_PURPOSE, user_id, kind)


def unsubscribe_email(db: Session, token: str) -> None:
    """Turn off the email switch the token names. Idempotent, and silent for an account that is
    gone. The caller commits."""
    user_id, kind = unsubscribe_tokens.verify(_EMAIL_UNSUBSCRIBE_PURPOSE, token)
    if kind not in NOTIFICATION_KINDS:
        raise InvalidUnsubscribeTokenError("This unsubscribe link is not valid.")
    user = db.get(User, user_id)
    if user is None:
        return
    update_preferences(
        db,
        user=user,
        body=UserPreferencesUpdate.model_validate({"notifications": {kind: False}}),
    )
