"""Create (or refresh) the three non-admin users the promo-video pipeline needs.

The promo records a community analyst clicking "I'm working on this" on a
request, which only renders when the viewer is NOT the request's author — hence
three distinct identities:

- ``analyst@vidit.app`` — the recording viewer, so the recorded sidebar /
  profile shows a community handle, not the admin badge.
- ``demo-analyst@vidit.app`` — the request author, so the viewer sees the
  participant view.
- ``analyst-helper@vidit.app`` — pre-seeds the "1 working" social proof on one
  list-view request; never the recording viewer (that would surface "You're
  working on this" instead of the "I'm working on this" beat).

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

# The promo recorder needs ``x`` pre-linked to the same handle as the seeded
# tweets so the import-from-tweet authorship check returns ``match`` and the
# form doesn't render the amber "no X account linked" / "different account"
# heads-up during recording. The other two users don't import tweets, so ``{}``.
RECORDER_X_HANDLE = "geo27752"

USERS = [
    # Recording viewer. Must be neither the request author nor the pre-seeded
    # claimer, or the "I'm working on this" beat collapses.
    ("analyst@vidit.app", "analyst", "analyst", {"x": RECORDER_X_HANDLE}),
    # Request author — owning the requests keeps the viewer in the participant
    # view ("I'm working on this") on the detail page.
    ("demo-analyst@vidit.app", "demo-analyst", "demo-analyst", {}),
    # Second analyst whose claim pre-seeds the "1 working" indicator on one
    # list-view request. `demo-analyst-1..5` already exist (seed-demo geolocation
    # flow), so this username stays outside that namespace.
    ("analyst-helper@vidit.app", "analyst-helper", "analyst-helper", {}),
]


def main() -> None:
    db = SessionLocal()
    try:
        for email, username, password, external_links in USERS:
            user = db.query(User).filter(User.email == email).first()
            if user:
                # Re-hash every run so the password is a fixed contract: a row
                # created earlier with a different password (old script version,
                # manual tinkering) would 401 the JS pipeline's
                # `mintAuth(..., password)` with no obvious cause.
                print(f"User {email} exists — refreshing password.")
                user.password_hash = hash_password(password)
                user.is_active = True
                user.email_verified_at = user.email_verified_at or datetime.now(UTC)
                user.external_links = external_links
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
                    external_links=external_links,
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
