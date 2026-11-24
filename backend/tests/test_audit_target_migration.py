"""Migration ``d4f6b8a0c2e4`` renames the event key of the admin log targets."""

import json
import uuid

import psycopg2
import pytest

from tests._migrations import alembic, database_at

REVISION = "d4f6b8a0c2e4"
DOWN_REVISION = "c3e5a7b9d1f2"
OLD_KEY = "geolocation_id"


@pytest.fixture
def pre_rename_db():
    with database_at("audit_target", DOWN_REVISION) as url:
        yield url


def _targets(url: str) -> dict[str, object]:
    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT action, target FROM audit_log")
        return dict(cur.fetchall())


def test_upgrade_renames_the_key_and_downgrade_restores_it(pre_rename_db):
    event = str(uuid.uuid4())
    rows = {
        "geolocation_soft_deleted": {OLD_KEY: event, "title": "Strike"},
        "approval_deleted": {OLD_KEY: event, "version_no": 2},
        "report_filed": {"event_id": event},
        "login": None,
    }
    with psycopg2.connect(pre_rename_db) as conn, conn.cursor() as cur:
        for action, target in rows.items():
            cur.execute(
                "INSERT INTO audit_log (id, action, target, created_at) VALUES (%s, %s, %s, now())",
                (str(uuid.uuid4()), action, None if target is None else json.dumps(target)),
            )

    alembic(pre_rename_db, "upgrade", REVISION)
    assert _targets(pre_rename_db) == {
        "geolocation_soft_deleted": {"event_id": event, "title": "Strike"},
        "approval_deleted": {"event_id": event, "version_no": 2},
        "report_filed": {"event_id": event},
        "login": None,
    }

    alembic(pre_rename_db, "downgrade", DOWN_REVISION)
    assert _targets(pre_rename_db) == rows
