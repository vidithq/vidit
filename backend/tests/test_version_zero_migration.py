"""``a2c4e6f8b0d1``: every row that was never published moves to version 0, a published row
keeps its number, the upgrade refuses a version stored against an unpublished row, and the
revision downgrades and upgrades again."""

import json
import subprocess
import uuid

import psycopg2
import pytest

from tests.test_revoke_reason_migration import _alembic, throwaway_db

_BEFORE = "fdb3f51c1477"
_REVISION = "a2c4e6f8b0d1"


def _uid() -> str:
    return str(uuid.uuid4())


def _owner(cur) -> str:
    user = _uid()
    cur.execute(
        "INSERT INTO users (id, username, email, password_hash, is_active, created_at) "
        "VALUES (%s, %s, %s, 'x', true, now())",
        (user, f"owner-{user[:8]}", f"{user}@example.com"),
    )
    return user


def _event(cur, owner: str, status: str, version_no: int, before: str | None = None) -> str:
    event = _uid()
    cur.execute(
        "INSERT INTO events (id, owner_id, title, proof, created_at, updated_at, status, "
        "before_closed_status, version_no, coords, requested_at, detected_at, geolocated_at, "
        "closed_at) VALUES (%s, %s, 'E', '', now(), now(), %s, %s, %s, "
        "ST_SetSRID(ST_MakePoint(2, 1), 4326), now(), now(), now(), "
        "CASE WHEN %s = 'closed' THEN now() END)",
        (event, owner, status, before, version_no, status),
    )
    return event


def _version(cur, event: str, version_no: int) -> None:
    cur.execute(
        "INSERT INTO event_versions (id, event_id, version_no, snapshot, created_at) "
        "VALUES (%s, %s, %s, %s, now())",
        (_uid(), event, version_no, json.dumps({"title": "E"})),
    )


@pytest.fixture
def before_db():
    with throwaway_db("version_zero", _BEFORE) as url:
        yield url


def test_unpublished_rows_move_to_version_0_and_round_trip(before_db):
    with psycopg2.connect(before_db) as conn, conn.cursor() as cur:
        owner = _owner(cur)
        ids = {
            "requested": _event(cur, owner, "requested", 1),
            "detected": _event(cur, owner, "detected", 1),
            "withdrawn": _event(cur, owner, "closed", 1, "requested"),
            "rejected": _event(cur, owner, "closed", 1, "detected"),
            "retracted": _event(cur, owner, "closed", 2, "geolocated"),
            "published": _event(cur, owner, "geolocated", 1),
            "edited": _event(cur, owner, "geolocated", 3),
        }
        _version(cur, ids["edited"], 1)
        _version(cur, ids["edited"], 2)
        _version(cur, ids["retracted"], 1)

    _alembic(before_db, "upgrade", _REVISION)
    with psycopg2.connect(before_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT id::text, version_no FROM events")
        numbers = dict(cur.fetchall())
        assert {name: numbers[event] for name, event in ids.items()} == {
            "requested": 0,
            "detected": 0,
            "withdrawn": 0,
            "rejected": 0,
            "retracted": 2,
            "published": 1,
            "edited": 3,
        }
        cur.execute("SELECT count(*) FROM event_versions")
        assert cur.fetchone() == (3,)
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute("UPDATE events SET version_no = 1 WHERE id = %s", (ids["detected"],))

    _alembic(before_db, "downgrade", _BEFORE)
    with psycopg2.connect(before_db) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM events WHERE version_no = 0")
        assert cur.fetchone() == (0,)
    _alembic(before_db, "upgrade", _REVISION)


def test_the_upgrade_refuses_a_version_of_an_unpublished_row(before_db):
    with psycopg2.connect(before_db) as conn, conn.cursor() as cur:
        detected = _event(cur, _owner(cur), "detected", 1)
        _version(cur, detected, 1)

    with pytest.raises(subprocess.CalledProcessError) as refused:
        _alembic(before_db, "upgrade", _REVISION)
    assert b"never published" in refused.value.stderr
