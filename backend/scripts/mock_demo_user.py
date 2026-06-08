"""Create (or refresh) the three non-admin users the promo-video pipeline
relies on.

The promo records a community analyst clicking "I'm working on this"
on a bounty, which only renders when the viewer is NOT the bounty's
author. Three distinct identities are needed:

- ``analyst@vidit.app`` — the recording viewer. The promo runs as
  this user so the recorded sidebar / profile shows a realistic
  community handle, not the admin badge.
- ``demo-analyst@vidit.app`` — the bounty author. Owns the seeded
  bounties so the viewer sees the participant view.
- ``analyst-helper@vidit.app`` — pre-seeds the "1 working" social
  proof on one bounty in the list view; never the recording viewer
  (that would surface "You're working on this" instead of the
  desired "I'm working on this" beat).

Each gets a stable email + password the JS scripts authenticate with.
"""

import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password

USERS = [
    # The recording viewer — the promo logs in as this user so the
    # recorded UI shows a realistic community handle, not the admin
    # badge. Must be neither the bounty author nor the pre-seeded
    # claimer (otherwise the "I'm working on this" beat collapses).
    ("analyst@vidit.app", "analyst", "analyst"),
    # The bounty author — bounties owned by someone other than the
    # recording viewer keep the viewer in the participant view
    # ("I'm working on this") on the detail page.
    ("demo-analyst@vidit.app", "demo-analyst", "demo-analyst"),
    # A second analyst whose "I'm working on this" click pre-seeds the
    # "1 working" indicator on one bounty in the list view.
    # `demo-analyst-1..5` already exist (created by the seed-demo
    # geolocation flow). Pick a username outside that namespace.
    ("analyst-helper@vidit.app", "analyst-helper", "analyst-helper"),
]


def main() -> None:
    db = SessionLocal()
    try:
        for email, username, password in USERS:
            user = db.query(User).filter(User.email == email).first()
            if user:
                # Re-hash the password on every run so the script keeps a
                # fixed contract — if the row was created earlier with a
                # different password (older version of this script, manual
                # tinkering), the JS pipeline's `mintAuth(..., password)`
                # would otherwise 401 with no obvious cause. Cheap.
                print(f"User {email} exists — refreshing password.")
                user.password_hash = hash_password(password)
                user.is_active = True
                user.email_verified_at = user.email_verified_at or datetime.now(UTC)
            else:
                print(f"Creating demo user: {email} / {password}")
                user = User(
                    id=uuid.uuid4(),
                    username=username,
                    email=email,
                    password_hash=hash_password(password),
                    is_admin=False,
                    is_active=True,
                    email_verified_at=datetime.now(UTC),
                )
                db.add(user)
        db.commit()
    except Exception as exc:
        print(f"Error: {exc}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
