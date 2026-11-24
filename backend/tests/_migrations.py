"""A scratch database held at one Alembic revision, for the data migration tests."""

import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg2

from app.config import settings
from tests.conftest import _admin_conn, _db_name, _swap_db


def alembic(url: str, *args: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


@contextmanager
def database_at(suffix: str, revision: str) -> Iterator[str]:
    """The URL of a fresh database migrated to ``revision``, dropped on exit."""
    name = f"{_db_name(settings.database_url)}_{suffix}"
    url = _swap_db(settings.database_url, name)
    admin = _admin_conn(settings.database_url)
    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{name}"')
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        alembic(url, "upgrade", revision)
        yield url
    finally:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()
