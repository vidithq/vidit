"""Migration ``b6d2f8a4c0e7`` stores each event's source order as it read before."""

import os
import subprocess
import sys
import uuid

import psycopg2
import pytest

from app.config import settings
from tests.conftest import _admin_conn, _db_name, _swap_db

REVISION = "b6d2f8a4c0e7"
DOWN_REVISION = "0df564d5f320"


def _alembic(url: str, *args: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


@pytest.fixture
def pre_position_db():
    name = f"{_db_name(settings.database_url)}_source_position"
    url = _swap_db(settings.database_url, name)
    admin = _admin_conn(settings.database_url)
    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{name}"')
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        _alembic(url, "upgrade", DOWN_REVISION)
        yield url
    finally:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()


def test_upgrade_keeps_the_order_each_event_read_in(pre_position_db):
    user, event, other = (str(uuid.uuid4()) for _ in range(3))
    # Inserted out of order: context first, a dated indirect, an undated and a dated direct.
    rows = [
        ("context", None, "2026-01-01T00:00:03Z"),
        ("indirect", "2026-01-02T00:00:00Z", "2026-01-01T00:00:02Z"),
        ("direct", None, "2026-01-01T00:00:01Z"),
        ("direct", "2026-01-03T00:00:00Z", "2026-01-01T00:00:04Z"),
    ]
    with psycopg2.connect(pre_position_db) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (id, username, email, password_hash, is_active, created_at) "
            "VALUES (%s, 'u', 'u@example.com', 'x', true, now())",
            (user,),
        )
        for event_id in (event, other):
            cur.execute(
                "INSERT INTO events (id, owner_id, title, proof, status, version_no, detected_at, "
                "created_at, updated_at) VALUES (%s, %s, 't', '', 'detected', 0, now(), now(), now())",
                (event_id, user),
            )
        for level, captured_at, created_at in rows:
            cur.execute(
                "INSERT INTO sources (id, event_id, title, level, kind, captured_at, created_at, "
                "updated_at) VALUES (%s, %s, %s, %s, 'other', %s, %s, now())",
                (str(uuid.uuid4()), event, f"{level} {captured_at}", level, captured_at, created_at),
            )
        cur.execute(
            "INSERT INTO sources (id, event_id, title, level, kind, created_at, updated_at) "
            "VALUES (%s, %s, 'lone', 'context', 'other', now(), now())",
            (str(uuid.uuid4()), other),
        )

    _alembic(pre_position_db, "upgrade", REVISION)

    with psycopg2.connect(pre_position_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT title FROM sources WHERE event_id = %s ORDER BY position", (event,))
        assert [title for (title,) in cur.fetchall()] == [
            "direct 2026-01-03T00:00:00Z",
            "direct None",
            "indirect 2026-01-02T00:00:00Z",
            "context None",
        ]
        cur.execute("SELECT position FROM sources WHERE event_id = %s", (other,))
        assert cur.fetchall() == [(0,)]

    _alembic(pre_position_db, "downgrade", DOWN_REVISION)
    with psycopg2.connect(pre_position_db) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'sources' AND column_name = 'position'"
        )
        assert cur.fetchone() is None
