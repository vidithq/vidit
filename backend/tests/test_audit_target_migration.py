"""Migration ``d4f6b8a0c2e4`` names the event resource "event" in the stored admin log."""

import json
import uuid

import psycopg2
import pytest

from tests._migrations import alembic, database_at

REVISION = "d4f6b8a0c2e4"
DOWN_REVISION = "c3e5a7b9d1f2"
# The stored names the migration replaces, spelled once.
OLD = "geolocation"


@pytest.fixture
def pre_rename_db():
    with database_at("audit_target", DOWN_REVISION) as url:
        yield url


def _targets(url: str) -> dict[str, object]:
    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT action, target FROM audit_log")
        return dict(cur.fetchall())


def test_upgrade_renames_actions_and_keys_and_downgrade_restores_them(pre_rename_db):
    event = str(uuid.uuid4())
    rows = {
        f"{OLD}_soft_deleted": {f"{OLD}_id": event, "title": "Strike"},
        f"{OLD}_hard_deleted": {f"{OLD}_id": event, "media_count": 3},
        "approval_deleted": {f"{OLD}_id": event, "version_no": 2},
        "user_soft_deleted": {f"cascaded_{OLD}s": 4, "transferred_events": 1},
        "user_hard_deleted": {f"{OLD}_count": 5, "transferred_count": 0},
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
        "event_soft_deleted": {"event_id": event, "title": "Strike"},
        "event_hard_deleted": {"event_id": event, "media_count": 3},
        "approval_deleted": {"event_id": event, "version_no": 2},
        "user_soft_deleted": {"cascaded_events": 4, "transferred_events": 1},
        "user_hard_deleted": {"event_count": 5, "transferred_count": 0},
        "report_filed": {"event_id": event},
        "login": None,
    }

    alembic(pre_rename_db, "downgrade", DOWN_REVISION)
    assert _targets(pre_rename_db) == rows
