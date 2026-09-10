"""add users.last_seen_at

Revision ID: o3q5s7u9w1y3
Revises: m1o3q5s7u9w1
Create Date: 2026-09-10 10:00:00.000000

``users.last_seen_at`` holds the instant of the account's most recent
authenticated request, throttled: ``dependencies.get_current_user`` refreshes it
once per ``LAST_SEEN_THROTTLE`` window rather than on every request, and the
login and register-confirm routes stamp it when they issue cookies. The admin
onboarding read names it as the account's activity, where the newest ``login``
auth event used to stand: a session lasts seven days and register-confirm opens
one without writing a login row, so an analyst who stays signed in and publishes
read as inactive.

Nullable, with no backfill: a row that has made no authenticated request since
this column landed carries NULL, and the onboarding read falls back to the
newest ``login`` auth event for it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "o3q5s7u9w1y3"
down_revision: Union[str, None] = "m1o3q5s7u9w1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # The column is the only record of an activity the auth log does not carry,
    # so dropping it loses it. Nothing else depends on the value: the onboarding
    # read falls back to the newest ``login`` auth event on its own.
    op.drop_column("users", "last_seen_at")
