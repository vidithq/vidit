"""Make a user follow every demo analyst so their /timeline page has content.

The timeline endpoint (`GET /api/v1/timeline`) returns geolocations from users
the caller follows. After `make seed`, demo geolocations exist but the local
admin's follow set is empty, so /timeline is blank. This script wires the
admin (or a chosen username) up to the demo analysts created by the seed.

Usage:
    uv run python scripts/seed_timeline.py            # follows for `admin`
    uv run python scripts/seed_timeline.py alice      # follows for `alice`
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.user import User
from app.services import social
from app.services.seed import DEMO_AUTHORS


def main() -> None:
    target_username = sys.argv[1] if len(sys.argv) > 1 else "admin"
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == target_username).first()
        if user is None:
            print(
                f"Error: user '{target_username}' not found. "
                "Run `make mock-admin` first (or pass an existing username)."
            )
            sys.exit(1)

        demo_usernames = [spec["username"] for spec in DEMO_AUTHORS]
        demo_users = db.query(User).filter(User.username.in_(demo_usernames)).all()
        existing = {u.username: u for u in demo_users}
        missing = [u for u in demo_usernames if u not in existing]
        if missing:
            print(
                "Warning: missing demo authors — run `make seed` first. "
                f"Missing: {', '.join(missing)}"
            )

        followed = 0
        for username in demo_usernames:
            target = existing.get(username)
            if target is None or target.id == user.id:
                continue
            if social.follow_user(db, follower_id=user.id, followed_user=target):
                followed += 1
        db.commit()
        print(
            f"Done. {target_username} now follows {followed} new demo analyst(s) "
            f"({len(existing)} total available)."
        )
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
