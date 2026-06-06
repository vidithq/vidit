"""seed capture_source taxonomy + conflict escape tag

Revision ID: s5n7p9r1t3v5
Revises: r4m6n8o0p2q4
Create Date: 2026-06-04 10:00:00.000000

Seeds two curated tag sets that the submit form now treats as REQUIRED
selectors (see ``routers/geolocations.py::create_geolocation``):

- ``capture_source`` — the original "lens" that captured the media
  (smartphone / satellite / drone / …). A brand-new structured tag
  category alongside the existing ``conflict`` / ``free`` buckets.
- a ``conflict`` escape value ("Other") so the now-required conflict
  selector stays satisfiable for an event outside the curated conflict
  list.

Why a migration and not the demo seeder: the demo seeder is a local-dev
helper and never runs in prod, but the *required* selectors must have
their options on a fresh prod DB the moment the new form ships.
``tags.name`` is globally UNIQUE, so ``ON CONFLICT (name) DO NOTHING``
makes this idempotent and tolerant of a pre-existing free tag that
happens to share one of these names (the rare clash leaves that one
option absent rather than crashing the migration — re-pick a name and
re-run if it ever bites in practice).

``tags.id`` has no server default (the ORM supplies ``uuid.uuid4`` at
the application layer), so a Core insert must pass ``id`` explicitly.
"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import insert as pg_insert

revision: str = "s5n7p9r1t3v5"
down_revision: Union[str, None] = "r4m6n8o0p2q4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The original-lens taxonomy. Ordered most-common-first for readers of
# this file; the API sorts by name for the UI. "Unknown" is the escape
# value that keeps the required selector satisfiable for media of
# uncertain provenance (re-shared footage, scrubbed metadata, …).
CAPTURE_SOURCE_TAGS = [
    "Smartphone",
    "Satellite",
    "Drone",
    "Static camera",
    "Dashcam",
    "Body / helmet cam",
    "Unknown",
]

# Escape value for the now-required conflict selector. The real conflict
# list stays owner-curated by direct DB access; this generic catch-all
# is part of the product taxonomy, so it ships in code.
CONFLICT_ESCAPE_TAGS = ["Other"]

# Lightweight Core handle — kept self-contained (no app-model import) so
# a later change to the Tag ORM model can't retro-alter this migration.
_tags = sa.table(
    "tags",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
    sa.column("category", sa.String()),
)


def _rows() -> list[dict]:
    return [
        {"id": uuid.uuid4(), "name": name, "category": "capture_source"}
        for name in CAPTURE_SOURCE_TAGS
    ] + [
        {"id": uuid.uuid4(), "name": name, "category": "conflict"}
        for name in CONFLICT_ESCAPE_TAGS
    ]


def upgrade() -> None:
    op.execute(
        pg_insert(_tags).values(_rows()).on_conflict_do_nothing(index_elements=["name"])
    )


def downgrade() -> None:
    # Delete by (name, category) so we never remove a same-named free
    # tag a user created. The geolocation_tags / bounty_tags FKs are
    # ON DELETE CASCADE, so any links to these rows drop with them.
    op.execute(
        _tags.delete().where(
            sa.and_(
                _tags.c.name.in_(CAPTURE_SOURCE_TAGS),
                _tags.c.category == "capture_source",
            )
        )
    )
    op.execute(
        _tags.delete().where(
            sa.and_(
                _tags.c.name.in_(CONFLICT_ESCAPE_TAGS),
                _tags.c.category == "conflict",
            )
        )
    )
