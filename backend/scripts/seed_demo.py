import sys
from pathlib import Path

# Add app to path
sys.path.append(str(Path(__file__).parent.parent))

from app.config import settings
from app.database import SessionLocal
from app.services.seed import NoTemplatesError, seed_demo


def main():
    db = SessionLocal()
    try:
        count = 50
        if len(sys.argv) > 1:
            count = int(sys.argv[1])

        # Ensure a dummy template exists if local storage is used and empty
        if settings.storage_backend == "local":
            pool_dir = Path(settings.local_storage_dir) / "demo-pool" / "geo-01" / "media"
            if not pool_dir.exists():
                pool_dir.mkdir(parents=True, exist_ok=True)
                (pool_dir / "placeholder.txt").write_text("Dummy media file for seeding.")
                print(f"Created dummy template at {pool_dir}")

        print(f"Seeding {count} demo geolocations...")
        result = seed_demo(db, count=count)
        print(
            f"Success: Created {result['created']} geolocations using {result['templates']} templates."
        )
    except NoTemplatesError as e:
        print(f"Error: {e}")
        print("Please ensure 'demo-pool/' directory exists in your storage.")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
