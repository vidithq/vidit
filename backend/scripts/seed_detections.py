"""Seed machine `detected` geolocations from the synthetic X archive.

A dev/admin trigger (no analyst-facing UI — that ships with the onboarding
flow). Runs the real backfill pipeline (acquire archive -> stitch -> detect ->
assemble) over the committed synthetic archive, attributing the detections to a
deterministic backfiller user so they render marked on the map. Idempotent —
re-running skips what already exists. Rows are ``is_demo`` so the demo-wipe
clears them.
"""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth import hash_password  # noqa: E402
from app.services.detection import backfill_from_archive  # noqa: E402

ARCHIVE = Path(__file__).parent.parent / "tests" / "data" / "synthetic_archive"
_HANDLE = "anademo"


def _get_or_create_owner(db) -> User:
    owner = db.query(User).filter(User.x_handle == _HANDLE).first()
    if owner is not None:
        return owner
    owner = User(
        username="ana-demo",
        email="ana-demo@vidit.app",
        password_hash=hash_password("password123"),
        x_handle=_HANDLE,
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return owner


def main() -> None:
    if not ARCHIVE.exists():
        print(f"Error: synthetic archive not found at {ARCHIVE}")
        sys.exit(1)
    db = SessionLocal()
    try:
        owner = _get_or_create_owner(db)
        print(f"Backfilling detections from {ARCHIVE.name} as @{owner.x_handle}...")
        outcome = asyncio.run(
            backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE, is_demo=True)
        )
        print(
            f"Success: {len(outcome.created)} detected geolocation(s) created, "
            f"{outcome.skipped} skipped, {outcome.recreated} recreated."
        )
    except Exception as exc:
        print(f"Error: {exc}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
