"""The event sources migration, ``fb4098ed6742``: an event's source URL and file become one
``direct`` source, each secondary link a source of its own, archives move onto the links,
snapshots are rewritten, and the graphic flag and sensor are carried; the downgrade maps back."""

import json
import uuid

import psycopg2
import pytest

from tests.test_revoke_reason_migration import _alembic, throwaway_db

_BASE = "4c85d28351c8"
_HEAD = "fb4098ed6742"
WAYBACK = "https://web.archive.org/web/20260501/https://x.com/a/status/1"
ARCHIVE_PH = "https://archive.ph/AbCd1"


def _uid() -> str:
    return str(uuid.uuid4())


def _one(cur, sql: str, *args):
    cur.execute(sql, args)
    return cur.fetchone()


def _all(cur, sql: str, *args) -> list:
    cur.execute(sql, args)
    return cur.fetchall()


def _event(cur, owner: str, status: str, source_url: str | None, **cols) -> str:
    event = _uid()
    stamp = {"geolocated": "geolocated_at", "requested": "requested_at", "detected": "detected_at"}
    cur.execute(
        "INSERT INTO events (id, owner_id, title, proof, created_at, updated_at, status, "
        f"{stamp[status]}, coords, source_url, source_posted_at, capture_source_coords, "
        "is_graphic) VALUES (%s, %s, 'E', '', now(), now(), %s, now(), "
        "ST_SetSRID(ST_MakePoint(34.5, 48.5), 4326), %s, %s, %s, %s)",
        (
            event,
            owner,
            status,
            source_url,
            cols.get("posted_at"),
            cols.get("camera"),
            cols.get("graphic", False),
        ),
    )
    return event


def _seed(cur) -> dict[str, str]:
    ids: dict[str, str] = {}
    owner = ids["owner"] = _uid()
    cur.execute(
        "INSERT INTO users (id, username, email, password_hash, is_active, created_at) "
        "VALUES (%s, %s, %s, 'x', true, now())",
        (owner, f"owner-{owner[:8]}", f"{owner}@example.com"),
    )
    full = ids["full"] = _event(
        cur,
        owner,
        "geolocated",
        "https://x.com/a/status/1",
        posted_at="2026-05-01T12:00:00+00:00",
        camera="SRID=4326;POINT(34.4 48.4)",
        graphic=True,
    )
    ids["request"] = _event(cur, owner, "requested", "https://t.me/c/9")
    ids["bare"] = _event(cur, owner, "detected", None)
    ids["file_only"] = _event(cur, owner, "detected", None)

    drone = _one(cur, "SELECT id FROM tags WHERE name = 'Drone'")[0]
    night = ids["night"] = _uid()
    cur.execute(
        "INSERT INTO tags (id, name, category, created_at) VALUES (%s, %s, 'free', now())",
        (night, f"night-{night[:8]}"),
    )
    for tag in (drone, night):
        cur.execute("INSERT INTO event_tags (event_id, tag_id) VALUES (%s, %s)", (full, tag))

    for event, role, url in (
        (full, "source", "s3://x/footage.jpg"),
        (full, "proof", "s3://x/proof.jpg"),
        (ids["file_only"], "source", "s3://x/only.mp4"),
    ):
        cur.execute(
            "INSERT INTO media (id, event_id, role, storage_url, kind, sha256, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, now())",
            (_uid(), event, role, url, "video" if url.endswith("mp4") else "image", "a" * 64),
        )
    for position, url in enumerate(("https://t.me/m/0", "https://t.me/m/1")):
        cur.execute(
            "INSERT INTO event_source_links (event_id, position, url) VALUES (%s, %s, %s)",
            (full, position, url),
        )
    for url, origin, snapshot, provider in (
        ("https://x.com/a/status/1", "source_url", WAYBACK, "wayback"),
        ("https://t.me/m/1", "secondary_source", ARCHIVE_PH, "archive_today"),
        ("https://x.com/me/status/5", "detected_from", ARCHIVE_PH, "archive_today"),
    ):
        cur.execute(
            "INSERT INTO source_archives (id, event_id, original_url, origin, snapshot_url, "
            "provider, created_at) VALUES (%s, %s, %s, %s, %s, %s, '2026-05-02T00:00:00Z')",
            (_uid(), full, url, origin, snapshot, provider),
        )

    cur.execute(
        "INSERT INTO event_versions (id, event_id, version_no, snapshot, created_at) "
        "VALUES (%s, %s, 1, %s, now())",
        (
            _uid(),
            full,
            json.dumps(
                {
                    "title": "Old",
                    "source_url": "https://x.com/a/status/1",
                    "source_media": [{"id": "m", "role": "source", "storage_url": "s3://x/v1.jpg"}],
                    "coords": {"lat": 48.5, "lng": 34.5},
                    "capture_source_coords": {"lat": 48.4, "lng": 34.4},
                    "occurred_date": None,
                    "occurred_time": None,
                    "source_posted_at": "2026-05-01T12:00:00+00:00",
                    "is_graphic": True,
                    "secondary_source_urls": ["https://t.me/m/0"],
                    "tags": [
                        {"id": str(drone), "name": "Drone", "category": "capture_source"},
                        {"id": night, "name": "night", "category": "free"},
                    ],
                    "conflicts": [],
                    "proof": "",
                    "proof_media": [{"id": "p", "role": "proof", "storage_url": "s3://x/p.jpg"}],
                    "archives": [
                        {
                            "original_url": "https://x.com/a/status/1",
                            "origin": "source_url",
                            "snapshot_url": WAYBACK,
                            "provider": "wayback",
                            "created_at": "2026-05-02T00:00:00+00:00",
                        }
                    ],
                }
            ),
        ),
    )
    return ids


@pytest.fixture
def base_db():
    with throwaway_db("event_sources", _BASE) as url:
        yield url


def test_the_migration_maps_sources_and_round_trips(base_db):
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        ids = _seed(cur)

    _alembic(base_db, "upgrade", _HEAD)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        _assert_head(cur, ids)

    _alembic(base_db, "downgrade", _BASE)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        _assert_base(cur, ids)

    _alembic(base_db, "upgrade", _HEAD)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        assert _one(cur, "SELECT version_num FROM alembic_version") == (_HEAD,)
        assert _one(cur, "SELECT count(*) FROM sources WHERE event_id = %s", ids["full"]) == (3,)


def _sources(cur, event: str) -> list:
    return _all(
        cur,
        "SELECT s.id, s.level, s.sensor, s.is_graphic, s.title, "
        "ST_Y(s.camera_position), ST_X(s.camera_position) FROM sources s "
        "WHERE s.event_id = %s ORDER BY s.created_at",
        event,
    )


def _links(cur, source: str) -> list:
    return _all(
        cur,
        "SELECT url, posted_at IS NOT NULL, snapshot_url, archived_at IS NOT NULL "
        "FROM source_links WHERE source_id = %s",
        source,
    )


def _assert_head(cur, ids: dict[str, str]) -> None:
    main, first_mirror, second_mirror = _sources(cur, ids["full"])
    assert main[1:] == ("direct", "drone", True, "", 48.4, 34.4)
    assert _links(cur, main[0]) == [("https://x.com/a/status/1", True, WAYBACK, True)]
    assert _one(cur, "SELECT storage_url, event_id FROM media WHERE source_id = %s", main[0]) == (
        "s3://x/footage.jpg",
        None,
    )
    for mirror, url, snapshot in (
        (first_mirror, "https://t.me/m/0", None),
        (second_mirror, "https://t.me/m/1", ARCHIVE_PH),
    ):
        assert mirror[1:4] == ("direct", "unknown", False)
        assert _links(cur, mirror[0]) == [(url, False, snapshot, snapshot is not None)]
        assert _one(cur, "SELECT count(*) FROM media WHERE source_id = %s", mirror[0]) == (0,)
    assert _one(cur, "SELECT storage_url FROM media WHERE event_id = %s", ids["full"]) == (
        "s3://x/proof.jpg",
    )

    [request] = _sources(cur, ids["request"])
    assert request[1:3] == ("direct", "unknown")
    assert _sources(cur, ids["bare"]) == []
    [file_only] = _sources(cur, ids["file_only"])
    assert _links(cur, file_only[0]) == []
    assert _one(cur, "SELECT count(*) FROM media WHERE source_id = %s", file_only[0]) == (1,)

    assert _all(
        cur,
        "SELECT t.id::text FROM event_tags et JOIN tags t ON t.id = et.tag_id "
        "WHERE et.event_id = %s",
        ids["full"],
    ) == [(ids["night"],)]
    assert _one(cur, "SELECT count(*) FROM tags WHERE name = 'Drone'") == (0,)

    (snapshot,) = _one(cur, "SELECT snapshot FROM event_versions WHERE event_id = %s", ids["full"])
    assert not {"source_url", "source_media", "secondary_source_urls", "archives"} & set(snapshot)
    assert snapshot["tags"] == [{"id": ids["night"], "name": "night"}]
    assert snapshot["proof_media"] == [{"id": "p", "role": "proof", "storage_url": "s3://x/p.jpg"}]
    main_entry, mirror_entry = snapshot["sources"]
    assert main_entry["sensor"] == "drone" and main_entry["is_graphic"] is True
    assert main_entry["camera_position"] == {"lat": 48.4, "lng": 34.4}
    assert main_entry["media"] == {"id": "m", "role": "source", "storage_url": "s3://x/v1.jpg"}
    assert main_entry["links"] == [
        {
            "url": "https://x.com/a/status/1",
            "posted_at": "2026-05-01T12:00:00+00:00",
            "snapshot_url": WAYBACK,
            "archived_at": "2026-05-02T00:00:00+00:00",
        }
    ]
    assert mirror_entry["sensor"] == "unknown" and mirror_entry["media"] is None
    assert [link["url"] for link in mirror_entry["links"]] == ["https://t.me/m/0"]


def _assert_base(cur, ids: dict[str, str]) -> None:
    full = ids["full"]
    assert _one(
        cur,
        "SELECT source_url, source_posted_at IS NOT NULL, is_graphic, "
        "ST_Y(capture_source_coords) FROM events WHERE id = %s",
        full,
    ) == ("https://x.com/a/status/1", True, True, 48.4)
    assert _all(
        cur, "SELECT position, url FROM event_source_links WHERE event_id = %s ORDER BY 1", full
    ) == [(0, "https://t.me/m/0"), (1, "https://t.me/m/1")]
    assert sorted(
        _all(
            cur,
            "SELECT original_url, origin, snapshot_url, provider FROM source_archives "
            "WHERE event_id = %s",
            full,
        )
    ) == [
        ("https://t.me/m/1", "secondary_source", ARCHIVE_PH, "archive_today"),
        ("https://x.com/a/status/1", "source_url", WAYBACK, "wayback"),
    ]
    assert sorted(_all(cur, "SELECT role, storage_url FROM media WHERE event_id = %s", full)) == [
        ("proof", "s3://x/proof.jpg"),
        ("source", "s3://x/footage.jpg"),
    ]
    assert sorted(
        _all(
            cur,
            "SELECT t.name, t.category FROM event_tags et JOIN tags t ON t.id = et.tag_id "
            "WHERE et.event_id = %s",
            full,
        )
    ) == [("Drone", "capture_source"), (f"night-{ids['night'][:8]}", "free")]
    assert _one(cur, "SELECT source_url FROM events WHERE id = %s", ids["request"]) == (
        "https://t.me/c/9",
    )
    assert _one(cur, "SELECT source_url FROM events WHERE id = %s", ids["file_only"]) == (None,)
    assert _one(
        cur, "SELECT count(*) FROM media WHERE event_id = %s AND role = 'source'", ids["file_only"]
    ) == (1,)

    (snapshot,) = _one(cur, "SELECT snapshot FROM event_versions WHERE event_id = %s", full)
    assert snapshot["source_url"] == "https://x.com/a/status/1"
    assert snapshot["source_media"] == [
        {"id": "m", "role": "source", "storage_url": "s3://x/v1.jpg"}
    ]
    assert snapshot["secondary_source_urls"] == ["https://t.me/m/0"]
    assert snapshot["is_graphic"] is True
    assert snapshot["source_posted_at"] == "2026-05-01T12:00:00+00:00"
    assert snapshot["capture_source_coords"] == {"lat": 48.4, "lng": 34.4}
    assert {(t["name"], t["category"]) for t in snapshot["tags"]} == {
        ("Drone", "capture_source"),
        ("night", "free"),
    }
    assert snapshot["proof_media"] == [{"id": "p", "role": "proof", "storage_url": "s3://x/p.jpg"}]
    assert [a["original_url"] for a in snapshot["archives"]] == ["https://x.com/a/status/1"]
