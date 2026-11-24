"""name the event resource "event" in the stored admin log

Revision ID: d4f6b8a0c2e4
Revises: c3e5a7b9d1f2
Create Date: 2026-11-24 16:00:00.000000

``audit_log`` is the only table whose stored values named the event resource
"geolocation": two action names and three keys of ``target``, its one JSON
column. The upgrade renames them in place and keeps every value:

* the actions of the admin event delete become ``event_soft_deleted`` and
  ``event_hard_deleted``;
* the event key of the delete, redaction and approval deletion targets
  becomes ``event_id``;
* the event count of the account soft delete becomes ``cascaded_events``,
  and that of the account hard delete ``event_count``.

The downgrade renames each back on the rows of the actions that wrote it.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6b8a0c2e4"
down_revision: Union[str, None] = "c3e5a7b9d1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIONS = {
    "geolocation_soft_deleted": "event_soft_deleted",
    "geolocation_hard_deleted": "event_hard_deleted",
}
# (old key, new key, the actions, by their new names, that wrote it)
KEYS = (
    (
        "geolocation_id",
        "event_id",
        ("event_soft_deleted", "event_hard_deleted", "event_version_redacted", "approval_deleted"),
    ),
    ("cascaded_geolocations", "cascaded_events", ("user_soft_deleted",)),
    ("geolocation_count", "event_count", ("user_hard_deleted",)),
)


def _rename_action(old: str, new: str) -> None:
    op.execute(f"UPDATE audit_log SET action = '{new}' WHERE action = '{old}'")


def _rename_key(old: str, new: str, actions: tuple[str, ...]) -> None:
    op.execute(
        f"""
        UPDATE audit_log
        SET target = ((target::jsonb - '{old}')
            || jsonb_build_object('{new}', target::jsonb -> '{old}'))::json
        WHERE target IS NOT NULL
          AND json_typeof(target) = 'object'
          AND target::jsonb ? '{old}'
          AND action IN ({", ".join(f"'{action}'" for action in actions)})
        """
    )


def upgrade() -> None:
    for old, new in ACTIONS.items():
        _rename_action(old, new)
    for old, new, actions in KEYS:
        _rename_key(old, new, actions)


def downgrade() -> None:
    for old, new, actions in KEYS:
        _rename_key(new, old, actions)
    for old, new in ACTIONS.items():
        _rename_action(new, old)
