"""name the event key of the admin log targets event_id

Revision ID: d4f6b8a0c2e4
Revises: c3e5a7b9d1f2
Create Date: 2026-11-24 16:00:00.000000

``audit_log.target`` is the only JSON column that ever carried the event under
the old key: the admin delete, redaction and approval deletion targets. The
upgrade renames that key to ``event_id`` in place, keeping its value. The
downgrade renames it back on the rows of the four actions that wrote it, the
only ones the old code read under that name.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6b8a0c2e4"
down_revision: Union[str, None] = "c3e5a7b9d1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_KEY = "geolocation_id"
NEW_KEY = "event_id"
ACTIONS = (
    "geolocation_soft_deleted",
    "geolocation_hard_deleted",
    "event_version_redacted",
    "approval_deleted",
)


def _rename(old: str, new: str, *, actions: tuple[str, ...] | None) -> None:
    scope = "" if actions is None else f" AND action IN ({', '.join(repr(a) for a in actions)})"
    op.execute(
        f"""
        UPDATE audit_log
        SET target = ((target::jsonb - '{old}')
            || jsonb_build_object('{new}', target::jsonb -> '{old}'))::json
        WHERE target IS NOT NULL
          AND json_typeof(target) = 'object'
          AND target::jsonb ? '{old}'{scope}
        """
    )


def upgrade() -> None:
    _rename(OLD_KEY, NEW_KEY, actions=None)


def downgrade() -> None:
    _rename(NEW_KEY, OLD_KEY, actions=ACTIONS)
