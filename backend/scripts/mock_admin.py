import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

# Add app to path
sys.path.append(str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password


def main():
    db = SessionLocal()
    try:
        email = "admin@vidit.app"
        username = "admin"
        password = "admin"

        user = db.query(User).filter(User.email == email).first()
        if user:
            print(f"User {email} already exists. Promoting to admin...")
            user.is_admin = True
            user.is_active = True
            user.email_verified_at = user.email_verified_at or datetime.now(UTC)
        else:
            print(f"Creating mock admin user: {email} / {password}")
            user = User(
                id=uuid.uuid4(),
                username=username,
                email=email,
                password_hash=hash_password(password),
                is_admin=True,
                is_active=True,
                email_verified_at=datetime.now(UTC),
            )
            db.add(user)

        db.commit()
        print("Done. You can now log in at http://localhost:3000/login with:")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
