"""Migration ``32730fceee8a``: a revoked approval may carry no reason, and the downgrade fills one."""

import importlib.util
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest

from app.config import settings
from tests.conftest import _admin_conn, _db_name, _swap_db

_PATH = (
    Path(__file__).parents[1]
    / "alembic"
    / "versions"
    / "32730fceee8a_optional_revoke_reason_and_revoke_notice.py"
)
_spec = importlib.util.spec_from_file_location("revoke_reason_migration", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def _alembic(url: str, command: str, revision: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", command, revision],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


@pytest.fixture
def pre_migration_db():
    """A throwaway database migrated to the revision before ``32730fceee8a``."""
    name = f"{_db_name(settings.database_url)}_revoke_reason"
    url = _swap_db(settings.database_url, name)
    admin = _admin_conn(settings.database_url)
    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{name}"')
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        _alembic(url, "upgrade", migration.down_revision)
        yield url
    finally:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        admin.close()


def _insert_approval(cur, event: str, reviewer: str, *, revoked: bool, reason: str | None) -> str:
    approval = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO event_approvals (id, event_id, version_no, reviewer_id, created_at, "
        "revoked_at, revoked_as, revoke_reason) VALUES (%s, %s, 1, %s, now(), "
        + ("now(), 'reviewer'" if revoked else "NULL, NULL")
        + ", %s)",
        (approval, event, reviewer, reason),
    )
    return approval


def test_upgrade_allows_a_revocation_without_reason_and_downgrade_fills_one(pre_migration_db):
    owner, reviewer, other, event = (str(uuid.uuid4()) for _ in range(4))
    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        for user, name in ((owner, "o"), (reviewer, "r"), (other, "x")):
            cur.execute(
                "INSERT INTO users (id, username, is_active, created_at) "
                "VALUES (%s, %s, true, now())",
                (user, name),
            )
        cur.execute(
            "INSERT INTO events (id, owner_id, title, proof, status, created_at, updated_at) "
            "VALUES (%s, %s, 't', '', 'detected', now(), now())",
            (event, owner),
        )
        kept = _insert_approval(cur, event, reviewer, revoked=True, reason="Wrong bridge")
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg2.errors.CheckViolation):
            _insert_approval(cur, event, other, revoked=True, reason=None)
        cur.execute("ROLLBACK TO SAVEPOINT s")

    _alembic(pre_migration_db, "upgrade", migration.revision)

    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        bare = _insert_approval(cur, event, other, revoked=True, reason=None)
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg2.errors.CheckViolation):
            _insert_approval(cur, event, owner, revoked=False, reason="No revocation")
        cur.execute("ROLLBACK TO SAVEPOINT s")
        cur.execute(
            "INSERT INTO notifications (id, user_id, kind, actor_id, event_id, approval_id, "
            "created_at) VALUES (%s, %s, 'approval_revoked', %s, %s, %s, now())",
            (str(uuid.uuid4()), owner, other, event, bare),
        )

    _alembic(pre_migration_db, "downgrade", migration.down_revision)

    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT id::text, revoke_reason FROM event_approvals")
        assert dict(cur.fetchall()) == {kept: "Wrong bridge", bare: "No reason given"}
        cur.execute("SELECT count(*) FROM notifications")
        assert cur.fetchone() == (0,)
