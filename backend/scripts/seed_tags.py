"""Backfill tags + a conflict onto live, untagged geolocations.

The demo seeder creates geolocations without tags, so the map's filter
buckets (which only surface values used by a live geolocation) stay empty.
This assigns each untagged geolocation one conflict + one ``capture_source``
tag (the curated pair every real submission must carry) plus a couple of
rotating ``free`` tags, so all filter buckets populate with variety.

Idempotent: geolocations that already carry tags are skipped. Assignment
rotates by row order (no randomness) so re-runs and reviews are reproducible.

    uv run python scripts/seed_tags.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from sqlalchemy.orm import selectinload

from app.database import SessionLocal
from app.models.conflict import Conflict
from app.models.event import Event
from app.models.tag import Tag


def main() -> None:
    db = SessionLocal()
    try:
        conflicts = db.query(Conflict).order_by(Conflict.name).all()
        capture = db.query(Tag).filter(Tag.category == "capture_source").order_by(Tag.name).all()
        free = db.query(Tag).filter(Tag.category == "free").order_by(Tag.name).all()
        if not conflicts or not capture:
            raise SystemExit(
                "Curated taxonomies missing (conflicts / capture_source). "
                "Run `uv run alembic upgrade head` first."
            )

        geos = (
            db.query(Event)
            .filter(Event.deleted_at.is_(None))
            .options(selectinload(Event.tags), selectinload(Event.conflicts))
            .order_by(Event.created_at)
            .all()
        )

        tagged = 0
        for i, geo in enumerate(geos):
            if geo.tags or geo.conflicts:
                continue
            geo.conflicts = [conflicts[i % len(conflicts)]]
            picks = [capture[i % len(capture)]]
            if free:
                picks.append(free[i % len(free)])
                picks.append(free[(i + 3) % len(free)])
            # Dedup while keeping order — a free tag can repeat for small pools.
            seen = set()
            unique = []
            for tag in picks:
                if tag.id not in seen:
                    seen.add(tag.id)
                    unique.append(tag)
            geo.tags = unique
            tagged += 1

        db.commit()
        print(f"Tagged {tagged} geolocations ({len(geos) - tagged} already had tags).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
