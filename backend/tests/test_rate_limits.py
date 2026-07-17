"""Behavioral tests for the shared slowapi limiter.

conftest's autouse `_disable_rate_limiter` turns the limiter off for the rest of
the suite (so unrelated tests don't trip 429s). These re-enable it via
`live_limiter` and pin the wiring: a per-endpoint quota returns 429 on N+1, the
limit is per-endpoint (no global floor — the phantom default this PR removed),
and `rate_limit_enabled` actually disables every limit. Each test keys its
bucket on a unique X-Forwarded-For IP and `live_limiter` resets the in-memory
store, so buckets don't bleed between tests.

The wiring tests pin the mechanism; the parametrized suite at the bottom pins
the documented limit of every read endpoint on the anonymous surface (N pass /
N+1 -> 429), the v0.4 read-endpoint anti-scraping floor. Extending the N/N+1
coverage to every documented write limit is the open-beta anti-scraping row in
planning/next.md.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)

ME = "/api/v1/users/me"


@pytest.fixture(autouse=True)
def _clear_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user(db):
    u = User(
        username=f"rl{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    yield u
    db.query(User).filter(User.id == u.id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def live_limiter():
    # Re-enable over the autouse disable; reset the store so the count starts at
    # zero regardless of suite order.
    limiter = app.state.limiter
    limiter.reset()
    limiter.enabled = True
    try:
        yield limiter
    finally:
        limiter.enabled = False
        limiter.reset()


def _auth(user: User, ip: str) -> dict[str, str]:
    # login_as sets the session + CSRF cookies and returns the CSRF header; the
    # XFF IP pins this caller to its own per-endpoint bucket (rate_limit_key
    # reads the right-most XFF entry).
    return {**login_as(client, user), "X-Forwarded-For": ip}


def test_write_limit_returns_429_after_quota(live_limiter, user):
    headers = _auth(user, "203.0.113.10")  # update_my_profile is 30/minute
    for i in range(30):
        resp = client.patch(ME, json={"bio": f"n{i}"}, headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    blocked = client.patch(ME, json={"bio": "over"}, headers=headers)
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Rate limit exceeded. Try again later."


def test_limit_is_per_endpoint_not_a_global_floor(live_limiter, user):
    # Exhaust the 30/min write bucket, then a different endpoint on the SAME IP
    # still answers: limits are per-endpoint, with no global floor catching
    # every route (the dead 60/min default this PR removed).
    headers = _auth(user, "203.0.113.11")
    for _ in range(30):
        assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 200
    assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 429
    profile = client.get(f"/api/v1/users/{user.username}", headers=headers)  # 120/min
    assert profile.status_code == 200


def test_disabled_limiter_never_blocks(user):
    # No `live_limiter` -> the autouse fixture leaves the limiter disabled.
    # Past-quota requests all pass: the toggle now governs every router, where
    # before the unify the per-router limiters ignored rate_limit_enabled.
    headers = _auth(user, "203.0.113.12")
    statuses = {
        client.patch(ME, json={"bio": f"n{i}"}, headers=headers).status_code for i in range(35)
    }
    assert statuses == {200}


def test_shared_limiter_fires_on_a_second_router(live_limiter, user, db):
    # Cross-router proof: the one shared limiter also enforces on the tags
    # router, not just users. Idempotent same-name create keeps it to a single
    # row (first 201, the rest 200) while the limiter counts every request.
    headers = _auth(user, "203.0.113.13")  # create_tag is 30/minute
    name = f"rl-{uuid.uuid4().hex[:8]}"
    try:
        for i in range(30):
            r = client.post(
                "/api/v1/tags", json={"name": name, "category": "free"}, headers=headers
            )
            assert r.status_code in (200, 201), f"request {i} was {r.status_code}"
        blocked = client.post(
            "/api/v1/tags", json={"name": name, "category": "free"}, headers=headers
        )
        assert blocked.status_code == 429
    finally:
        db.query(Tag).filter(Tag.name == name).delete(synchronize_session=False)
        db.commit()


# ── Per-documented-limit coverage: the anonymous read surface ──────────────
# One behavioral check per documented read limit (docs/api.md → Rate limits):
# N requests answer, N+1 returns 429. Anonymous throughout — these endpoints
# are the public exposure the limits exist for. A 404 body (unknown id /
# username) still counts: the limiter runs before the handler, so the check
# needs no fixture rows and pins the quota, not the payload. Each case gets
# its own XFF IP, so buckets never bleed across cases.

_READ_LIMITS = [
    ("/api/v1/events", 120),
    (f"/api/v1/events/{uuid.UUID(int=0)}", 120),
    ("/api/v1/events/points", 60),
    ("/api/v1/search?q=vidit", 60),
    ("/api/v1/search/authors?q=vidit", 60),
    ("/api/v1/tags", 60),
    ("/api/v1/conflicts", 60),
    ("/api/v1/users/no-such-user", 120),
    ("/api/v1/users/no-such-user/events", 120),
    ("/api/v1/users/no-such-user/stats", 120),
]


@pytest.mark.parametrize(("path", "limit"), _READ_LIMITS, ids=[p for p, _ in _READ_LIMITS])
def test_documented_read_limit_blocks_at_n_plus_1(live_limiter, path, limit):
    ip = f"198.51.100.{_READ_LIMITS.index((path, limit)) + 1}"
    for i in range(limit):
        resp = client.get(path, headers={"X-Forwarded-For": ip})
        assert resp.status_code != 429, f"request {i} already 429"
    blocked = client.get(path, headers={"X-Forwarded-For": ip})
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Rate limit exceeded. Try again later."


def test_documented_detections_queue_limit(live_limiter, user):
    # The one non-anonymous read on the documented table: the owner's
    # detections queue, 120/min.
    headers = _auth(user, "198.51.100.120")
    for i in range(120):
        resp = client.get("/api/v1/events/detections", headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    assert client.get("/api/v1/events/detections", headers=headers).status_code == 429
