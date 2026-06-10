"""Behavioral tests for the shared slowapi limiter.

conftest's autouse `_disable_rate_limiter` turns the limiter off for the rest of
the suite (so unrelated tests don't trip 429s). These re-enable it via
`live_limiter` and pin the wiring: a per-endpoint quota returns 429 on N+1, the
limit is per-endpoint (no global floor — the phantom default this PR removed),
and `rate_limit_enabled` actually disables every limit. Each test keys its
bucket on a unique X-Forwarded-For IP and `live_limiter` resets the in-memory
store, so buckets don't bleed between tests.

Comprehensive coverage of every documented limit (N pass / N+1 -> 429) is the
open-beta anti-scraping row in planning/next.md; this module pins the mechanism.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
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
