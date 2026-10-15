"""add the withdrawn review request status

Revision ID: a2abb5b374d8
Revises: 89ba7b32bb5d
Create Date: 2026-10-16 12:00:00.000000

A review request whose requester loses their credit on the event is withdrawn
rather than deleted, so it stays on record and keeps counting toward the
requester's daily cap. ``ck_review_requests_status_valid`` admits the value.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2abb5b374d8"
down_revision: Union[str, None] = "89ba7b32bb5d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_review_requests_status_valid", "review_requests", type_="check")
    op.create_check_constraint(
        "ck_review_requests_status_valid",
        "review_requests",
        "status IN ('open', 'approved', 'declined', 'withdrawn')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM review_requests WHERE status = 'withdrawn'")
    op.drop_constraint("ck_review_requests_status_valid", "review_requests", type_="check")
    op.create_check_constraint(
        "ck_review_requests_status_valid",
        "review_requests",
        "status IN ('open', 'approved', 'declined')",
    )
