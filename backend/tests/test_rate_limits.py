"""Behavioral tests for the shared slowapi limiter.

conftest's autouse `_disable_rate_limiter` turns the limiter off; these
re-enable it via `live_limiter`. Each test keys its bucket on a unique
X-Forwarded-For IP, so buckets don't bleed between tests.

`_READ_LIMITS` and `_DOCUMENTED_LIMITS` pin one case per row of docs/api.md
-> Rate limits, so dropping a `@limiter.limit` decorator fails here.
"""

from __future__ import annotations

import uuid
from typing import Any, NamedTuple

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.database import SessionLocal
from app.main import (
    RATE_LIMITED_CODE,
    READ_QUOTA_EXCEEDED_CODE,
    app,
)
from app.models.admin_event import AdminEvent
from app.models.invite_code import InviteCode
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import (
    AUTHENTICATED_READ_LIMIT,
    AUTHENTICATED_READ_SCOPE,
    authenticated_read_key,
)
from app.services.auth import create_access_token, hash_password
from app.services.auth_cookies import SESSION_COOKIE
from app.services.sanitize import tiptap_doc_from_text
from tests.conftest import login_as
from tests.events._helpers import WORLD_BBOX

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
def admin_user(db):
    u = User(
        username=f"rla{uuid.uuid4().hex[:8]}",
        email=f"admin-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id
    yield u
    # Reap the admin audit rows and invite codes so the user row deletes
    # without FK violations.
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(InviteCode).filter(InviteCode.used_by == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def live_limiter():
    limiter = app.state.limiter
    limiter.reset()
    limiter.enabled = True
    try:
        yield limiter
    finally:
        limiter.enabled = False
        limiter.reset()


def _auth(user: User, ip: str) -> dict[str, str]:
    # The XFF IP pins this caller to its own bucket (rate_limit_key reads the
    # right-most entry).
    return {**login_as(client, user), "X-Forwarded-For": ip}


def _assert_throttled(resp, code: str = RATE_LIMITED_CODE) -> None:
    # The code separates a per-endpoint throttle from the hour-long read quota.
    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == code
    assert int(resp.headers["Retry-After"]) >= 1


def test_write_limit_returns_429_after_quota(live_limiter, user):
    headers = _auth(user, "203.0.113.10")  # update_my_profile is 30/minute
    for i in range(30):
        resp = client.patch(ME, json={"bio": f"n{i}"}, headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    _assert_throttled(client.patch(ME, json={"bio": "over"}, headers=headers))


def test_limit_is_per_endpoint_not_a_global_floor(live_limiter, user):
    # Exhaust the 30/min write bucket; another endpoint on the same IP still
    # answers (no global floor).
    headers = _auth(user, "203.0.113.11")
    for _ in range(30):
        assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 200
    assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 429
    profile = client.get(f"/api/v1/users/{user.username}", headers=headers)  # 120/min
    assert profile.status_code == 200


def test_disabled_limiter_never_blocks(user):
    # No `live_limiter`: the autouse fixture leaves the limiter disabled.
    headers = _auth(user, "203.0.113.12")
    statuses = {
        client.patch(ME, json={"bio": f"n{i}"}, headers=headers).status_code for i in range(35)
    }
    assert statuses == {200}


def test_shared_limiter_fires_on_a_second_router(live_limiter, user, db):
    # The shared limiter also enforces on the tags router. Same-name creates
    # are idempotent (first 201, then 200), so one row exists.
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


# N requests answer, N+1 returns 429, anonymously. A 404 body still counts:
# the limiter runs before the handler.

_READ_LIMITS = [
    ("/api/v1/events", 120),
    (f"/api/v1/events/{uuid.UUID(int=0)}", 120),
    # ``bbox`` is required: validation runs before the limiter, so a bare call
    # would 422 without touching the bucket.
    (f"/api/v1/events/points?bbox={WORLD_BBOX}", 60),
    ("/api/v1/search?q=vidit", 60),
    ("/api/v1/search/authors?q=vidit", 60),
    ("/api/v1/tags", 60),
    ("/api/v1/conflicts", 60),
    ("/api/v1/users/no-such-user", 120),
    ("/api/v1/users/no-such-user/events", 120),
    ("/api/v1/users/no-such-user/stats", 120),
    ("/api/v1/users/no-such-user/collections", 120),
    (f"/api/v1/collections/{uuid.UUID(int=0)}", 120),
    (f"/api/v1/collections/{uuid.UUID(int=0)}/events", 120),
]


# The IP comes from the row's position, so identical rows can't share a bucket.
@pytest.mark.parametrize(
    ("index", "path", "limit"),
    [(i, path, limit) for i, (path, limit) in enumerate(_READ_LIMITS)],
    ids=[p for p, _ in _READ_LIMITS],
)
def test_documented_read_limit_blocks_at_n_plus_1(live_limiter, index, path, limit):
    ip = f"198.51.100.{index + 1}"
    for i in range(limit):
        resp = client.get(path, headers={"X-Forwarded-For": ip})
        assert resp.status_code != 429, f"request {i} already 429"
    _assert_throttled(client.get(path, headers={"X-Forwarded-For": ip}))


def test_documented_detections_queue_limit(live_limiter, user):
    # The one non-anonymous read in the table (120/min).
    headers = _auth(user, "198.51.100.120")
    for i in range(120):
        resp = client.get("/api/v1/events/detections", headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    assert client.get("/api/v1/events/detections", headers=headers).status_code == 429


# 1000/hour keyed by ``User.id``, one bucket for the whole read surface.

_READ_QUOTA = int(AUTHENTICATED_READ_LIMIT.split("/")[0])

# Paths covered by the quota (docs/api.md -> Per-user read quota), as route templates.
_QUOTA_ROUTES = [
    "/api/v1/events",
    "/api/v1/events/{geolocation_id}",
    "/api/v1/events/points",
    "/api/v1/events/detections",
    "/api/v1/events/possible-duplicates",
    "/api/v1/search",
    "/api/v1/search/authors",
    "/api/v1/tags",
    "/api/v1/conflicts",
    "/api/v1/users/{username}",
    "/api/v1/users/{username}/stats",
    "/api/v1/users/{username}/events",
    "/api/v1/users/{username}/collections",
    "/api/v1/collections/{collection_id}",
    "/api/v1/collections/{collection_id}/events",
    "/api/v1/timeline",
]


@pytest.mark.parametrize("path", _QUOTA_ROUTES, ids=_QUOTA_ROUTES)
def test_quota_is_wired_on_every_documented_read(path):
    # Reads the registration so all thirteen routes are covered cheaply, and
    # pins the decorator order: the per-IP limit (scope `""`) must register
    # first so a rejected request never spends the account's hourly budget.
    route = next(
        r
        for r in app.routes
        if getattr(r, "path", None) == path and "GET" in getattr(r, "methods", ())
    )
    name = f"{route.endpoint.__module__}.{route.endpoint.__name__}"
    scopes = [lim.scope for lim in app.state.limiter._route_limits.get(name, [])]
    assert scopes == ["", AUTHENTICATED_READ_SCOPE]


# Two cheap 404 reads on different routers: alternating proves one shared budget.
_QUOTA_PATHS = ("/api/v1/users/no-such-user", f"/api/v1/events/{uuid.UUID(int=0)}")


def _rotating_ip(i: int) -> str:
    # A fresh address per request, so only the per-user quota can answer 429.
    # 198.18.0.0/15 is the reserved benchmarking range.
    return f"198.18.{i // 256}.{i % 256}"


def test_read_quota_walls_an_account_across_endpoints_and_ips(live_limiter, user, db):
    headers = login_as(client, user)
    for i in range(_READ_QUOTA):
        resp = client.get(
            _QUOTA_PATHS[i % 2],
            headers={**headers, "X-Forwarded-For": _rotating_ip(i)},
        )
        assert resp.status_code != 429, f"request {i} already 429"

    # The budget belongs to the account, not to a URL or an address.
    fresh_ip = {"X-Forwarded-For": "198.19.0.1"}
    blocked = client.get("/api/v1/tags", headers={**headers, **fresh_ip})
    _assert_throttled(blocked, READ_QUOTA_EXCEEDED_CODE)

    client.cookies.clear()
    assert client.get("/api/v1/tags", headers=fresh_ip).status_code == 200

    other = User(
        username=f"rl{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(other)
    db.commit()
    try:
        other_headers = login_as(client, other)
        assert client.get("/api/v1/tags", headers={**other_headers, **fresh_ip}).status_code == 200
    finally:
        db.query(User).filter(User.id == other.id).delete(synchronize_session=False)
        db.commit()


def _quota_remaining(user: User) -> int:
    """Tokens left in ``user``'s hourly read bucket, read from the store."""
    limits = app.state.limiter._route_limits["app.routers.tags.list_tags"]
    item = next(lim.limit for lim in limits if lim.scope == AUTHENTICATED_READ_SCOPE)
    _reset_at, remaining = app.state.limiter.limiter.get_window_stats(
        item, f"user:{user.id}", AUTHENTICATED_READ_SCOPE
    )
    return remaining


def test_per_ip_rejection_does_not_charge_the_read_quota(live_limiter, user):
    # Requests rejected by the per-minute limit (`GET /tags`, 60/min per IP)
    # must not cost hourly budget.
    per_ip_limit = 60
    headers = _auth(user, "203.0.113.20")
    for i in range(per_ip_limit):
        assert client.get("/api/v1/tags", headers=headers).status_code == 200, f"request {i}"
    for _ in range(20):
        _assert_throttled(client.get("/api/v1/tags", headers=headers))

    assert _quota_remaining(user) == _READ_QUOTA - per_ip_limit

    fresh = {**headers, "X-Forwarded-For": "203.0.113.21"}
    assert client.get("/api/v1/tags", headers=fresh).status_code == 200
    assert _quota_remaining(user) == _READ_QUOTA - per_ip_limit - 1


def _request_with_cookie(cookie: str | None) -> Request:
    """A bare Request carrying (or not) a session cookie."""
    headers = [(b"cookie", f"{SESSION_COOKIE}={cookie}".encode())] if cookie else []
    return Request({"type": "http", "headers": headers})


def test_read_quota_key_follows_the_account_not_the_session(user):
    # The key is the user id, so a second session can't reset a spent quota.
    first = authenticated_read_key(_request_with_cookie(create_access_token(user)))
    second = authenticated_read_key(_request_with_cookie(create_access_token(user)))
    assert first == second == f"user:{user.id}"


def test_read_quota_key_rejects_a_forged_token(user):
    # Unsigned, tampered, or absent cookies land on the anonymous key, so a
    # hand-written `sub` can't mint a fresh bucket.
    anonymous = authenticated_read_key(_request_with_cookie(None))
    forged = create_access_token(user).rsplit(".", 1)[0] + ".forged-signature"
    assert authenticated_read_key(_request_with_cookie(forged)) == anonymous
    assert authenticated_read_key(_request_with_cookie("not-a-jwt")) == anonymous
    assert anonymous != f"user:{user.id}"


# N requests answer, N+1 returns 429. The N+1 assertion also proves all N
# reached the limiter: slowapi counts inside the endpoint wrapper, so requests
# rejected earlier (CSRF, validation, a failing dependency) never accrue.
# Payloads therefore clear validation and fail inside the handler (unknown id,
# unparseable date, unknown invite code), so none stores evidence.
#
# Some groups still write, each reaped by a fixture:
# * `/auth/login` writes an `auth_events` row per attempt;
# * `PATCH /users/me` and `DELETE /users/me/avatar` touch the throwaway `user` row;
# * admin actions write `admin_events` rows and `POST /admin/invite-codes`
#   mints 30 codes;
# * `POST /collections` opens 30 collections (dropped by the owner cascade);
# * the `reap-*` cases delete expired `auth_tokens` / `pending_registrations`.

_MISSING_ID = uuid.UUID(int=0)

# A Tiptap document, enough to pass body validation.
_PROBE_DESCRIPTION = tiptap_doc_from_text("A probe shelf.")

# The unparseable date makes every submit handler 422 before touching storage.
# `files` forces the multipart body the File(...) parameters require.
_SUBMIT_FORM = {
    "title": "rate limit probe",
    "lat": "0",
    "lng": "0",
    "source_url": "https://example.com/post",
    "source_posted_at": "2026-01-01T00:00",
    "event_date": "not-a-date",
}
_SUBMIT_FILE = {"files": {"file": ("probe.txt", b"probe", "text/plain")}}
_GEOLOCATE_FILE = {"files": {"files": ("probe.txt", b"probe", "text/plain")}}


class _Case(NamedTuple):
    method: str
    path: str
    limit: int
    # "anon", "user", or "admin".
    role: str = "user"
    payload: dict[str, Any] | None = None


_DOCUMENTED_LIMITS = [
    # Auth: anonymous and CSRF-exempt (middleware/csrf.py). Login is 5/min +
    # 30/hour; only the minute tier is reachable here.
    _Case(
        "post",
        "/api/v1/auth/login",
        5,
        "anon",
        {"json": {"email": "rl@example.com", "password": "wrong-password"}},
    ),
    _Case(
        "post",
        "/api/v1/auth/register",
        10,
        "anon",
        {
            "json": {
                "username": "rlprobe",
                "email": "rl-probe@example.com",
                "password": "password123",
                "invite_code": "not-a-real-code",
            }
        },
    ),
    _Case(
        "post",
        "/api/v1/auth/confirm-registration",
        30,
        "anon",
        {"json": {"token": "not-a-real-token"}},
    ),
    _Case(
        "post",
        "/api/v1/auth/resend-confirmation",
        5,
        "anon",
        {"json": {"email": "rl-nobody@example.com"}},
    ),
    _Case(
        "post",
        "/api/v1/auth/forgot-password",
        5,
        "anon",
        {"json": {"email": "rl-nobody@example.com"}},
    ),
    _Case(
        "post",
        "/api/v1/auth/reset-password",
        10,
        "anon",
        {"json": {"token": "not-a-real-token", "new_password": "password123"}},
    ),
    # Keyed per session, not per IP: pins the custom key func.
    _Case(
        "post",
        "/api/v1/auth/change-password",
        10,
        "user",
        {"json": {"current_password": "wrong-password", "new_password": "password123"}},
    ),
    _Case(
        "get", "/api/v1/events/possible-duplicates", 60, "user", {"params": {"lat": 0, "lng": 0}}
    ),
    _Case("get", f"/api/v1/events/import-archive/{_MISSING_ID}", 60),
    _Case("get", "/api/v1/timeline", 120),
    _Case(
        "post",
        "/api/v1/events/import-from-tweet",
        30,
        "user",
        {"json": {"url": "https://example.com/not-a-tweet"}},
    ),
    _Case("post", "/api/v1/events/import-archive/presign", 10),
    _Case(
        "post",
        "/api/v1/events/import-archive",
        10,
        "user",
        {"json": {"upload_key": "not-a-staged-key"}},
    ),
    _Case("post", "/api/v1/events", 30, "user", {"data": _SUBMIT_FORM, **_SUBMIT_FILE}),
    _Case("post", "/api/v1/events/requests", 30, "user", {"data": _SUBMIT_FORM, **_SUBMIT_FILE}),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/geolocate",
        30,
        "user",
        {"data": _SUBMIT_FORM, **_GEOLOCATE_FILE},
    ),
    # The conflict id resolves to nothing, so the call 400s before any lock.
    _Case(
        "post",
        "/api/v1/events/batch-complete",
        10,
        "user",
        {
            "json": {
                "conflict_ids": [str(_MISSING_ID)],
                "rows": [
                    {
                        "event_id": str(_MISSING_ID),
                        "capture_source_tag_id": str(_MISSING_ID),
                    }
                ],
            }
        },
    ),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/close",
        60,
        "user",
        {"json": {"close_reason": "probe"}},
    ),
    # Open to anonymous viewers; 10/hour is the tightest write limit.
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/report",
        10,
        "anon",
        {"json": {"reason": "other"}},
    ),
    _Case(
        "post",
        "/api/v1/tags",
        30,
        "user",
        {"json": {"name": "rate-limit-probe", "category": "capture_source"}},
    ),
    _Case("patch", ME, 30, "user", {"json": {"bio": "probe"}}),
    # The PUT probe is `text/plain`: rejected before any storage write.
    _Case(
        "put",
        f"{ME}/avatar",
        20,
        "user",
        {"files": {"file": ("probe.txt", b"probe", "text/plain")}},
    ),
    _Case("delete", f"{ME}/avatar", 20),
    _Case("post", "/api/v1/users/no-such-user/follow", 60),
    _Case("delete", "/api/v1/users/no-such-user/follow", 60),
    # The create stores a row per request; the other probes 404 after the limiter.
    _Case(
        "post",
        "/api/v1/collections",
        30,
        "user",
        {"json": {"title": "rate limit probe", "description": _PROBE_DESCRIPTION}},
    ),
    _Case(
        "patch",
        f"/api/v1/collections/{_MISSING_ID}",
        30,
        "user",
        {"json": {"title": "probe", "description": _PROBE_DESCRIPTION}},
    ),
    _Case("delete", f"/api/v1/collections/{_MISSING_ID}", 30),
    _Case("put", f"/api/v1/collections/{_MISSING_ID}/events/{_MISSING_ID}", 60),
    _Case("delete", f"/api/v1/collections/{_MISSING_ID}/events/{_MISSING_ID}", 60),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/collections", 120),
    _Case("post", "/api/v1/admin/invite-codes", 30, "admin", {"json": {}}),
    _Case("post", f"/api/v1/admin/invite-codes/{_MISSING_ID}/revoke", 60, "admin"),
    _Case("delete", f"/api/v1/admin/invite-codes/{_MISSING_ID}", 60, "admin"),
    _Case(
        "patch",
        f"/api/v1/admin/users/{_MISSING_ID}/x-handle",
        60,
        "admin",
        {"json": {"x_handle": "someone"}},
    ),
    _Case("delete", f"/api/v1/admin/users/{_MISSING_ID}", 30, "admin"),
    _Case("delete", f"/api/v1/admin/users/{_MISSING_ID}/detected-events", 30, "admin"),
    _Case("delete", f"/api/v1/admin/events/{_MISSING_ID}", 60, "admin"),
    _Case("delete", f"/api/v1/admin/collections/{_MISSING_ID}", 60, "admin"),
    _Case(
        "post",
        f"/api/v1/admin/reports/{_MISSING_ID}/resolve",
        60,
        "admin",
        {"json": {"resolution": "dismissed"}},
    ),
    _Case(
        "patch",
        f"/api/v1/admin/events/{_MISSING_ID}/moderation",
        60,
        "admin",
        {"json": {"hidden": True}},
    ),
    _Case("post", "/api/v1/admin/maintenance/reap-auth-tokens", 30, "admin"),
    _Case("post", "/api/v1/admin/maintenance/reap-pending-registrations", 30, "admin"),
]


@pytest.mark.parametrize(
    ("index", "case"),
    list(enumerate(_DOCUMENTED_LIMITS)),
    ids=[f"{c.method.upper()} {c.path}" for c in _DOCUMENTED_LIMITS],
)
def test_documented_limit_blocks_at_n_plus_1(live_limiter, user, admin_user, index, case):
    ip = f"192.0.2.{index + 1}"
    if case.role == "anon":
        headers = {"X-Forwarded-For": ip}
    else:
        headers = _auth(user if case.role == "user" else admin_user, ip)
    payload = case.payload or {}

    for i in range(case.limit):
        resp = client.request(case.method.upper(), case.path, headers=headers, **payload)
        assert resp.status_code != 429, f"request {i} already 429"
    _assert_throttled(client.request(case.method.upper(), case.path, headers=headers, **payload))
