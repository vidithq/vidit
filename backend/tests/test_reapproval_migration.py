"""Migration ``0c2f6f5dfd3f``: a self-revoked approval leaves room for a new one, and a sent
delivery outlives its notification."""

import importlib.util
import uuid
from pathlib import Path

import psycopg2
import pytest

from tests.test_revoke_reason_migration import _alembic, _insert_approval, seed_event, throwaway_db

_PATH = (
    Path(__file__).parents[1]
    / "alembic"
    / "versions"
    / "0c2f6f5dfd3f_reapprove_after_self_revoke_and_keep_sent_deliveries.py"
)
_spec = importlib.util.spec_from_file_location("reapproval_migration", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


@pytest.fixture
def pre_migration_db():
    with throwaway_db("reapproval", migration.down_revision) as url:
        yield url


def _notification_with_sent_delivery(cur, owner: str, actor: str) -> tuple[str, str]:
    notification, delivery = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute(
        "INSERT INTO notifications (id, user_id, kind, actor_id, created_at) "
        "VALUES (%s, %s, 'new_follower', %s, now())",
        (notification, owner, actor),
    )
    cur.execute(
        "INSERT INTO notification_deliveries (id, notification_id, channel, status, attempts, "
        "created_at, sent_at) VALUES (%s, %s, 'email', 'sent', 0, now(), now())",
        (delivery, notification),
    )
    return notification, delivery


def test_upgrade_reopens_a_self_revoked_review_and_keeps_sent_deliveries(pre_migration_db):
    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        owner, reviewer, other, event = seed_event(cur)
        _insert_approval(cur, event, reviewer, revoked=True, reason=None)
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg2.errors.UniqueViolation):
            _insert_approval(cur, event, reviewer, revoked=False, reason=None)
        cur.execute("ROLLBACK TO SAVEPOINT s")

    _alembic(pre_migration_db, "upgrade", migration.revision)

    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        newest = _insert_approval(cur, event, reviewer, revoked=False, reason=None)
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg2.errors.UniqueViolation):
            _insert_approval(cur, event, reviewer, revoked=False, reason=None)
        cur.execute("ROLLBACK TO SAVEPOINT s")
        notification, delivery = _notification_with_sent_delivery(cur, owner, other)
        cur.execute("DELETE FROM notifications WHERE id = %s", (notification,))
        cur.execute(
            "SELECT notification_id FROM notification_deliveries WHERE id = %s", (delivery,)
        )
        assert cur.fetchone() == (None,)

    _alembic(pre_migration_db, "downgrade", migration.down_revision)

    with psycopg2.connect(pre_migration_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT id::text FROM event_approvals WHERE reviewer_id = %s", (reviewer,))
        assert cur.fetchall() == [(newest,)]
        cur.execute("SELECT count(*) FROM notification_deliveries")
        assert cur.fetchone() == (0,)
