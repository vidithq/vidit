"""rename review requests to approval requests

Revision ID: 05d8a0952992
Revises: t4k8x2m6q0z3
Create Date: 2026-10-16 22:00:00.000000

The feature takes one word, approval, everywhere:

- ``review_requests`` becomes ``approval_requests``, with every constraint and index whose name
  carries the table name.
- ``user_preferences.review_request_audience`` and ``organizations.review_request_audience``
  become ``approval_request_audience``, with their check constraints.
- The notification kinds ``review_request_received`` and ``review_request_declined`` become
  ``approval_request_received`` and ``approval_request_declined``: the stored rows, the
  ``ck_notifications_kind_valid`` list and the keys of ``user_preferences.notification_overrides``.
  Delivery rows reference their notification and carry no kind.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "05d8a0952992"
down_revision: Union[str, None] = "t4k8x2m6q0z3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OTHER_KINDS = (
    "'request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_manager_inherited', 're_approve_requested', 'approval_received', "
)
_LAST_KIND = ", 'organization_approval_removed'"
_AUDIENCE = "IN ('following', 'everyone', 'nobody')"


def _kinds(word: str) -> str:
    return (
        "kind IN ("
        + _OTHER_KINDS
        + f"'{word}_request_received', '{word}_request_declined'"
        + _LAST_KIND
        + ")"
    )


def _rename_names(table: str, old: str, new: str) -> None:
    """Rename every constraint, then every index, of ``table`` whose name carries ``old``.
    Constraints first: renaming a primary key or unique constraint renames its index too.
    Postgres 18 names NOT NULL constraints after their column, so they are covered here."""
    op.execute(
        f"""
        DO $$
        DECLARE r record;
        BEGIN
          FOR r IN SELECT conname FROM pg_constraint
                   WHERE conrelid = '{table}'::regclass AND conname LIKE '%{old}%' LOOP
            EXECUTE format('ALTER TABLE {table} RENAME CONSTRAINT %I TO %I',
                           r.conname, replace(r.conname, '{old}', '{new}'));
          END LOOP;
          FOR r IN SELECT indexname FROM pg_indexes
                   WHERE tablename = '{table}' AND indexname LIKE '%{old}%' LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO %I',
                           r.indexname, replace(r.indexname, '{old}', '{new}'));
          END LOOP;
        END $$;
        """
    )


def _rename(old: str, new: str) -> None:
    op.rename_table(f"{old}_requests", f"{new}_requests")
    _rename_names(f"{new}_requests", f"{old}_requests", f"{new}_requests")

    for table in ("user_preferences", "organizations"):
        op.drop_constraint(f"ck_{table}_{old}_request_audience", table, type_="check")
        op.alter_column(table, f"{old}_request_audience", new_column_name=f"{new}_request_audience")
        op.create_check_constraint(
            f"ck_{table}_{new}_request_audience", table, f"{new}_request_audience {_AUDIENCE}"
        )
        _rename_names(table, f"{old}_request_audience", f"{new}_request_audience")

    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.execute(
        f"UPDATE notifications SET kind = replace(kind, '{old}_request_', '{new}_request_')"
        f" WHERE kind IN ('{old}_request_received', '{old}_request_declined')"
    )
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _kinds(new))
    for suffix in ("received", "declined"):
        before, after = f"{old}_request_{suffix}", f"{new}_request_{suffix}"
        op.execute(
            "UPDATE user_preferences SET notification_overrides ="
            f" (notification_overrides - '{before}')"
            f" || jsonb_build_object('{after}', notification_overrides -> '{before}')"
            f" WHERE notification_overrides ? '{before}'"
        )


def upgrade() -> None:
    _rename("review", "approval")


def downgrade() -> None:
    _rename("approval", "review")
