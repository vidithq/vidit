"""rename_geolocations_analysis_to_proof

Revision ID: a1b2c3d4e5f6
Revises: faac60e89c44
Create Date: 2026-05-06 09:00:00.000000

The "analysis" name was vague — the column holds the analyst's
proof-of-geolocation: annotated media frames cross-referenced with map
screenshots showing matching anchor points. "proof" is OSINT vernacular
and unambiguous in context (Geolocation.proof).

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "faac60e89c44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("geolocations", "analysis", new_column_name="proof")


def downgrade() -> None:
    op.alter_column("geolocations", "proof", new_column_name="analysis")
