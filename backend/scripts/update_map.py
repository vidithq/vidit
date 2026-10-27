"""Refresh the self-hosted map files in the map bucket, once.

For a weekly scheduler (the ``update-map`` role) or by hand. Exits non-zero on
any failure, leaving the files ``latest.json`` names in place
(``services/map_files``).
    uv run python scripts/update_map.py
"""

import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.observability import configure_logging, init_sentry
from app.services.map_files import MapConfig, MapUpdateError, http_client, map_storage, run

logger = logging.getLogger("app.update_map")


def main() -> None:
    configure_logging()
    init_sentry()
    try:
        config = MapConfig.from_settings()
        with http_client() as http:
            latest = run(config, http=http, s3=map_storage())
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        logger.error(
            "update-map failed, latest.json unchanged: %s",
            exc,
            exc_info=not isinstance(exc, MapUpdateError),
        )
        raise SystemExit(1) from exc
    logger.info("update-map done: planet %s", latest["planet"]["version"])


if __name__ == "__main__":
    main()
