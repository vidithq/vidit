"""admit 'geolocated' in before_closed_status

Revision ID: i7k9m1o3q5s7
Revises: g5i7k9m1o3q5
Create Date: 2026-08-19 18:00:00.000000

An owner closes an event in any of the three live states, so the closed row's
discriminator carries a third value: ``geolocated``, a public retraction. The
CHECK is dropped and recreated with the widened domain; the iff between
``status = 'closed'`` and a non-NULL discriminator is unchanged.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i7k9m1o3q5s7"
down_revision: Union[str, None] = "g5i7k9m1o3q5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_events_before_closed_status"
# The explicit ``IS NOT NULL`` is load-bearing: ``NULL IN (...)`` is unknown,
# and Postgres accepts any CHECK that is not FALSE.
WIDENED = (
    "(status = 'closed' AND before_closed_status IS NOT NULL"
    " AND before_closed_status IN ('requested', 'detected', 'geolocated'))"
    " OR (status <> 'closed' AND before_closed_status IS NULL)"
)
PREVIOUS = (
    "(status = 'closed' AND before_closed_status IS NOT NULL"
    " AND before_closed_status IN ('requested', 'detected'))"
    " OR (status <> 'closed' AND before_closed_status IS NULL)"
)


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, "events", type_="check")
    op.create_check_constraint(CONSTRAINT, "events", WIDENED)


def downgrade() -> None:
    # A retracted row is outside the narrowed domain, so it goes back to the
    # published state it left; the close stamps are cleared with it, which
    # ``ck_events_closed_stamp`` requires of a non-closed row.
    op.execute(
        "UPDATE events SET status = 'geolocated', before_closed_status = NULL,"
        " closed_at = NULL, close_reason = NULL"
        " WHERE status = 'closed' AND before_closed_status = 'geolocated'"
    )
    op.drop_constraint(CONSTRAINT, "events", type_="check")
    op.create_check_constraint(CONSTRAINT, "events", PREVIOUS)
