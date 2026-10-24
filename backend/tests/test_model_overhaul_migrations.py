"""The data model overhaul migrations, ``6a3943ca4316`` to ``4c85d28351c8``: each maps the
stored rows onto the new shape, the NOT NULL step refuses a legacy NULL, and the chain
downgrades to its base and upgrades again."""

import json
import subprocess
import uuid

import psycopg2
import pytest

from tests.test_revoke_reason_migration import _alembic, throwaway_db

_BASE = "361664db5722"
_BEFORE_NOT_NULL = "7e8e211df661"
_HEAD = "4c85d28351c8"


def _uid() -> str:
    return str(uuid.uuid4())


def _user(cur, name: str) -> str:
    user = _uid()
    cur.execute(
        "INSERT INTO users (id, username, email, password_hash, is_active, created_at, "
        "email_verified_at) VALUES (%s, %s, %s, 'x', true, now(), now())",
        (user, f"{name}-{user[:8]}", f"{user}@example.com"),
    )
    return user


def _seed(cur) -> dict[str, str]:
    """Rows in the shape of the base revision, one per mapping the chain performs."""
    ids = {name: _user(cur, name) for name in ("owner", "reviewer", "revoker", "former")}
    ids |= {name: _user(cur, name) for name in ("leaver", "invitee", "returning", "member")}
    owner = ids["owner"]

    event = ids["event"] = _uid()
    cur.execute(
        "INSERT INTO events (id, owner_id, title, proof, created_at, updated_at, status, "
        "detected_at, event_date, detected_via, detected_from_url, detected_from_tweet_id, "
        "detected_thread_tweet_ids, detected_post_at) VALUES (%s, %s, 'E', '', now(), now(), "
        "'detected', now(), '2026-01-02', 'bot', 'https://x.com/a/status/7', 7, ARRAY[7, 8], "
        "now())",
        (event, owner),
    )
    human = ids["human"] = _uid()
    cur.execute(
        "INSERT INTO events (id, owner_id, title, proof, created_at, updated_at, status, "
        "detected_at) VALUES (%s, %s, 'H', '', now(), now(), 'detected', now())",
        (human, owner),
    )
    cur.execute(
        "INSERT INTO event_versions (id, event_id, version_no, snapshot, created_at) "
        "VALUES (%s, %s, 1, %s, now())",
        (
            _uid(),
            event,
            json.dumps(
                {
                    "title": "E",
                    "event_coords": {"lat": 1.0, "lng": 2.0},
                    "event_date": "2026-01-02",
                    "event_time": None,
                    "source_media": [{"url": "u", "media_type": "video"}],
                    "proof_media": [{"url": "p1", "media_type": "image"}, {"url": "p2"}],
                }
            ),
        ),
    )
    cur.execute(
        "INSERT INTO media (id, event_id, storage_url, media_type, created_at, sha256, role) "
        "VALUES (%s, %s, 's3://x/m', 'image', now(), %s, 'source')",
        (_uid(), event, "a" * 64),
    )

    standing, revoked = ids["standing"], ids["revoked"] = _uid(), _uid()
    cur.execute(
        "INSERT INTO event_approvals (id, event_id, version_no, reviewer_id, note, created_at) "
        "VALUES (%s, %s, 1, %s, 'looks right', now())",
        (standing, event, ids["reviewer"]),
    )
    cur.execute(
        "INSERT INTO event_approvals (id, event_id, version_no, reviewer_id, created_at, "
        "revoked_at, revoked_by_id, revoked_as) VALUES (%s, %s, 1, %s, now(), now(), %s, "
        "'reviewer')",
        (revoked, event, ids["revoker"], ids["revoker"]),
    )
    for kind, approval in (
        ("approval_received", standing),
        ("approval_received", revoked),
        ("approval_revoked", None),
        ("x_handle_request_approved", None),
        ("request_fulfilled", None),
    ):
        notification = _uid()
        ids[f"{kind}:{approval}"] = notification
        cur.execute(
            "INSERT INTO notifications (id, user_id, kind, event_id, approval_id, created_at) "
            "VALUES (%s, %s, %s, %s, %s, now())",
            (notification, owner, kind, event, approval),
        )
    fulfilled = ids["request_fulfilled:None"]
    for channel, status in (("email", "sent"), ("push", "queued")):
        cur.execute(
            "INSERT INTO notification_deliveries (id, notification_id, channel, status, "
            "attempts, created_at, sent_at) VALUES (%s, %s, %s, %s, 0, now(), now())",
            (_uid(), fulfilled, channel, status),
        )
    cur.execute(
        "INSERT INTO user_preferences (user_id, notification_overrides, updated_at) "
        "VALUES (%s, %s, now())",
        (
            owner,
            json.dumps(
                {
                    "request_fulfilled": {"email": False, "push": True},
                    "new_follower": {"push": True},
                    "x_handle_request_approved": {"email": False},
                }
            ),
        ),
    )

    for user, table in (
        (owner, "event_geolocators"),
        (ids["former"], "event_geolocators"),
        (ids["former"], "event_geolocator_departures"),
        (ids["leaver"], "event_geolocator_departures"),
        (ids["invitee"], "event_geolocator_invites"),
        (ids["returning"], "event_geolocator_departures"),
        (ids["returning"], "event_geolocator_invites"),
    ):
        cur.execute(
            f"INSERT INTO {table} (event_id, user_id, created_at) VALUES (%s, %s, now())",
            (event, user),
        )

    org = ids["org"] = _uid()
    cur.execute(
        "INSERT INTO organizations (id, slug, name, created_at) VALUES (%s, %s, 'O', now())",
        (org, f"o-{org[:8]}"),
    )
    cur.execute(
        "INSERT INTO organization_members (organization_id, user_id, role, joined_at) "
        "VALUES (%s, %s, 'manager', now())",
        (org, owner),
    )
    cur.execute(
        "INSERT INTO organization_invites (id, organization_id, user_id, invited_by_id, "
        "created_at) VALUES (%s, %s, %s, %s, now())",
        (_uid(), org, ids["member"], owner),
    )

    cur.execute(
        "INSERT INTO admin_events (id, actor_id, action, target, created_at) "
        "VALUES (%s, %s, 'invite_revoked', '{\"k\": 1}', now())",
        (_uid(), owner),
    )
    cur.execute(
        "INSERT INTO auth_events (id, user_id, event, created_at) VALUES (%s, %s, 'login', now())",
        (_uid(), ids["reviewer"]),
    )
    cur.execute(
        "INSERT INTO auth_events (id, user_id, event, created_at) "
        "VALUES (%s, NULL, 'failed_login', now())",
        (_uid(),),
    )

    cur.execute(
        "INSERT INTO bot_mentions (id, mention_tweet_id, author_handle, outcome, "
        "events_created, processed_at) VALUES (%s, '111', 'h', 'created', 1, now())",
        (_uid(),),
    )
    for tweet_id, status in (("222", "queued"), ("333", "done"), ("111", "queued")):
        cur.execute(
            "INSERT INTO bot_webhook_events (id, mention, status, attempts, created_at) "
            "VALUES (%s, %s, %s, 0, now())",
            (
                _uid(),
                json.dumps({"tweet_id": tweet_id, "author_id": "1", "author_handle": "H"}),
                status,
            ),
        )
    return ids


def _one(cur, sql: str, *args):
    cur.execute(sql, args)
    return cur.fetchone()


def _all(cur, sql: str, *args) -> list:
    cur.execute(sql, args)
    return cur.fetchall()


@pytest.fixture
def base_db():
    with throwaway_db("model_overhaul", _BASE) as url:
        yield url


def test_the_chain_maps_the_stored_rows_and_round_trips(base_db):
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        ids = _seed(cur)
    _alembic(base_db, "upgrade", _BEFORE_NOT_NULL)

    # A legacy NULL holds the NOT NULL step back until it is resolved.
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        legacy = _uid()
        cur.execute(
            "INSERT INTO users (id, username, is_active, created_at) "
            "VALUES (%s, 'legacy', true, now())",
            (legacy,),
        )
    with pytest.raises(subprocess.CalledProcessError) as refused:
        _alembic(base_db, "upgrade", _HEAD)
    assert b"users.email: 1 row(s)" in refused.value.stderr
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (legacy,))

    _alembic(base_db, "upgrade", _HEAD)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        _assert_head(cur, ids)

    _alembic(base_db, "downgrade", _BASE)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        _assert_base(cur, ids)

    _alembic(base_db, "upgrade", _HEAD)
    with psycopg2.connect(base_db) as conn, conn.cursor() as cur:
        assert _one(cur, "SELECT version_num FROM alembic_version") == (_HEAD,)
        assert _one(cur, "SELECT count(*) FROM event_geolocators WHERE event_id = %s", ids["event"])


def _assert_head(cur, ids: dict[str, str]) -> None:
    owner, event = ids["owner"], ids["event"]
    # Phase 1: one email switch per kind, email the only channel, approvals final.
    (overrides,) = _one(
        cur, "SELECT notification_overrides FROM user_preferences WHERE user_id = %s", owner
    )
    assert overrides == {"request_fulfilled": False}
    assert _all(cur, "SELECT status FROM notification_deliveries") == [("done",)]
    assert _all(cur, "SELECT id FROM event_approvals") == [(ids["standing"],)]
    kinds = {k for (k,) in _all(cur, "SELECT kind FROM notifications")}
    assert kinds == {"approval_received", "request_fulfilled"}
    assert _one(cur, "SELECT count(*) FROM notifications WHERE kind = 'approval_received'") == (1,)

    # Phase 2: renamed snapshot keys, in order, and the new columns.
    (snapshot,) = _one(cur, "SELECT snapshot FROM event_versions WHERE event_id = %s", event)
    assert snapshot["coords"] == {"lat": 1.0, "lng": 2.0}
    assert snapshot["occurred_date"] == "2026-01-02" and "occurred_time" in snapshot
    assert not {"event_coords", "event_date", "event_time"} & set(snapshot)
    assert snapshot["source_media"] == [{"url": "u", "kind": "video"}]
    assert snapshot["proof_media"] == [{"url": "p1", "kind": "image"}, {"url": "p2"}]
    assert _one(cur, "SELECT kind FROM media WHERE event_id = %s", event) == ("image",)
    assert _one(cur, "SELECT occurred_date FROM events WHERE id = %s", event)[0].isoformat() == (
        "2026-01-02"
    )

    # Phase 3: one audit log, one geolocator row per analyst, one member row, detections.
    audit = _all(cur, "SELECT actor_id, action, target FROM audit_log ORDER BY action")
    assert audit == [
        (None, "failed_login", None),
        (owner, "invite_revoked", {"k": 1}),
        (ids["reviewer"], "login", None),
    ]
    states = dict(
        _all(
            cur,
            "SELECT user_id, state || ':' || (departed_at IS NOT NULL)::text "
            "FROM event_geolocators WHERE event_id = %s",
            event,
        )
    )
    assert states == {
        owner: "active:false",
        ids["former"]: "active:true",
        ids["leaver"]: "departed:true",
        ids["invitee"]: "invited:false",
        ids["returning"]: "invited:true",
    }
    members = dict(
        _all(
            cur,
            "SELECT user_id, state || ':' || role FROM organization_members "
            "WHERE organization_id = %s",
            ids["org"],
        )
    )
    assert members == {
        owner: "active:manager",
        ids["member"]: "invited:member",
    }
    detections = _all(
        cur, "SELECT event_id, via, from_url, from_post_id, thread_post_ids FROM event_detections"
    )
    assert detections == [(event, "bot", "https://x.com/a/status/7", 7, [7, 8])]

    # Phase 4: the pending queue row joins the ledger, the processed one and the duplicate go.
    rows = _all(
        cur,
        "SELECT mention_post_id, author_x_handle, status, outcome, payload IS NOT NULL "
        "FROM bot_mentions ORDER BY mention_post_id",
    )
    assert rows == [(111, "h", "done", "created", False), (222, "h", "queued", None, True)]


def _assert_base(cur, ids: dict[str, str]) -> None:
    owner, event = ids["owner"], ids["event"]
    (overrides,) = _one(
        cur, "SELECT notification_overrides FROM user_preferences WHERE user_id = %s", owner
    )
    assert overrides == {"request_fulfilled": {"email": False}}
    (snapshot,) = _one(cur, "SELECT snapshot FROM event_versions WHERE event_id = %s", event)
    assert snapshot["event_coords"] == {"lat": 1.0, "lng": 2.0}
    assert snapshot["source_media"] == [{"url": "u", "media_type": "video"}]
    assert _all(cur, "SELECT user_id FROM event_geolocator_invites ORDER BY user_id") == sorted(
        [(ids["invitee"],), (ids["returning"],)]
    )
    departed = {u for (u,) in _all(cur, "SELECT user_id FROM event_geolocator_departures")}
    assert departed == {ids[n] for n in ("former", "leaver", "returning")}
    assert _one(cur, "SELECT count(*) FROM organization_invites") == (1,)
    assert _one(cur, "SELECT count(*) FROM auth_events") == (2,)
    assert _one(cur, "SELECT action FROM admin_events") == ("invite_revoked",)
    assert _one(
        cur, "SELECT detected_from_tweet_id, detected_via FROM events WHERE id = %s", event
    ) == (7, "bot")
    queued = _all(cur, "SELECT mention ->> 'tweet_id', status FROM bot_webhook_events")
    assert queued == [("222", "queued")]
    assert _one(cur, "SELECT mention_tweet_id FROM bot_mentions") == ("111",)
    assert _one(cur, "SELECT email_verified_at IS NOT NULL FROM users WHERE id = %s", owner) == (
        True,
    )
