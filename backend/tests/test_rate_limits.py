"""Behavioral tests for the shared slowapi limiter.

conftest's autouse `_disable_rate_limiter` turns the limiter off for the rest of
the suite (so unrelated tests don't trip 429s). These re-enable it via
`live_limiter` and pin the wiring: a per-endpoint quota returns 429 on N+1, the
limit is per-endpoint (no global floor — the phantom default this PR removed),
and `rate_limit_enabled` actually disables every limit. Each test keys its
bucket on a unique X-Forwarded-For IP and `live_limiter` resets the in-memory
store, so buckets don't bleed between tests.

The wiring tests pin the mechanism. Two parametrized suites pin the numbers:
`_READ_LIMITS` covers the anonymous read surface and `_DOCUMENTED_LIMITS` the
write / auth / admin surface, one case per row of docs/api.md → Rate limits, so
dropping a `@limiter.limit` decorator fails here instead of shipping. The
per-user read quota (one bucket per account across the whole read surface) has
its own tests in between: one behavioral pass over the shared bucket, plus a
route-registration sweep that catches a `@authenticated_read_quota` dropped
from any of the thirteen documented paths without a thousand-request loop.
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
    # Reap what the admin cases below leave behind, so the row deletes without
    # FK violations and no case depends on a later one to clean up after it:
    # the audit rows every admin action writes and the invite codes the create
    # case mints.
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(InviteCode).filter(InviteCode.used_by == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
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


def _assert_throttled(resp, code: str = RATE_LIMITED_CODE) -> None:
    # Every 429 carries the typed `{"code", "message"}` envelope plus a
    # Retry-After in seconds, and the code is what separates a per-endpoint
    # throttle from the hour-long read quota.
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
    # ``bbox`` is required here: FastAPI's parameter validation runs before
    # the limiter, so a bare call would 422 without ever touching the bucket.
    (f"/api/v1/events/points?bbox={WORLD_BBOX}", 60),
    ("/api/v1/search?q=vidit", 60),
    ("/api/v1/search/authors?q=vidit", 60),
    ("/api/v1/tags", 60),
    ("/api/v1/conflicts", 60),
    ("/api/v1/users/no-such-user", 120),
    ("/api/v1/users/no-such-user/events", 120),
    ("/api/v1/users/no-such-user/stats", 120),
]


# Parametrized over `enumerate` so each case's IP comes from its position in
# the list, not from a value-equality lookup: two rows that happened to be
# identical would otherwise resolve to the same index, share one bucket, and
# turn the second case's first request into the first case's N+1.
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
    # The one non-anonymous read on the documented table: the owner's
    # detections queue, 120/min.
    headers = _auth(user, "198.51.100.120")
    for i in range(120):
        resp = client.get("/api/v1/events/detections", headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    assert client.get("/api/v1/events/detections", headers=headers).status_code == 429


# ── The per-user read quota ────────────────────────────────────────────────
# 1000/hour keyed by ``User.id``, one bucket for the whole read surface. The
# per-IP limits above bound a client; this one bounds an account, so a
# logged-in scraper cycling through source addresses still hits a wall.

# Derived from the shipped limit string rather than restated, so raising the
# quota doesn't leave a test asserting the old number.
_READ_QUOTA = int(AUTHENTICATED_READ_LIMIT.split("/")[0])

# Every documented path the quota is meant to cover (docs/api.md → Per-user
# read quota), as FastAPI route templates.
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
    "/api/v1/timeline",
]


@pytest.mark.parametrize("path", _QUOTA_ROUTES, ids=_QUOTA_ROUTES)
def test_quota_is_wired_on_every_documented_read(path):
    # The behavioral test below fills the shared bucket through two endpoints,
    # so dropping `@authenticated_read_quota` from any of the other eleven
    # ships green. This sweep reads the registration instead: cheap enough to
    # cover all thirteen, and it also pins the decorator ORDER, which no 429
    # assertion can see. slowapi evaluates a route's limits in registration
    # order, charging each in turn and breaking on the first failure, and
    # decorators register bottom-up: the per-IP limit must land first so that
    # a request it rejects never spends a token of the account's hourly
    # budget. Scope `""` is the per-endpoint limit (unnamed, so slowapi
    # defaults it to the route).
    route = next(
        r
        for r in app.routes
        if getattr(r, "path", None) == path and "GET" in getattr(r, "methods", ())
    )
    name = f"{route.endpoint.__module__}.{route.endpoint.__name__}"
    scopes = [lim.scope for lim in app.state.limiter._route_limits.get(name, [])]
    assert scopes == ["", AUTHENTICATED_READ_SCOPE]


# Two 404 reads (one query each) so a 1000-request pass stays cheap. They sit
# on different routers, so filling the bucket by alternating between them also
# proves the quota is one shared budget rather than a per-endpoint allowance.
_QUOTA_PATHS = ("/api/v1/users/no-such-user", f"/api/v1/events/{uuid.UUID(int=0)}")


def _rotating_ip(i: int) -> str:
    # A fresh source address per request, so every per-IP bucket sees exactly
    # one hit and only the per-user quota can ever answer 429. 198.18.0.0/15 is
    # the reserved benchmarking range.
    return f"198.18.{i // 256}.{i % 256}"


def test_read_quota_walls_an_account_across_endpoints_and_ips(live_limiter, user, db):
    headers = login_as(client, user)
    for i in range(_READ_QUOTA):
        resp = client.get(
            _QUOTA_PATHS[i % 2],
            headers={**headers, "X-Forwarded-For": _rotating_ip(i)},
        )
        assert resp.status_code != 429, f"request {i} already 429"

    # A third read endpoint, untouched so far and on a fresh IP, is blocked:
    # the budget belongs to the account, not to a URL or an address.
    fresh_ip = {"X-Forwarded-For": "198.19.0.1"}
    blocked = client.get("/api/v1/tags", headers={**headers, **fresh_ip})
    # The quota's own code, not the generic throttle's: an hour-long fixed
    # window and a per-minute limit are different waits.
    _assert_throttled(blocked, READ_QUOTA_EXCEEDED_CODE)

    # Anonymous traffic never accrues, so the public read surface is untouched
    # by what the account spent.
    client.cookies.clear()
    assert client.get("/api/v1/tags", headers=fresh_ip).status_code == 200

    # And the quota is per account: a second analyst is unaffected.
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
    """Tokens left in ``user``'s hourly read bucket, read from the store.

    Reads the same (item, key, scope) triple ``__evaluate_limits`` hits with,
    taking the limit off a route's registration so the assertion can't drift
    from the shipped quota. Beats spending the rest of the budget on requests
    to find out where it stands.
    """
    limits = app.state.limiter._route_limits["app.routers.tags.list_tags"]
    item = next(lim.limit for lim in limits if lim.scope == AUTHENTICATED_READ_SCOPE)
    _reset_at, remaining = app.state.limiter.limiter.get_window_stats(
        item, f"user:{user.id}", AUTHENTICATED_READ_SCOPE
    )
    return remaining


def test_per_ip_rejection_does_not_charge_the_read_quota(live_limiter, user):
    # An analyst bursting past the per-minute limit on one address must not
    # pay for the rejected requests out of their hourly budget: the endpoint's
    # own limit is evaluated first and breaks the chain before the quota is
    # charged. `GET /tags` is 60/minute per IP.
    per_ip_limit = 60
    headers = _auth(user, "203.0.113.20")
    for i in range(per_ip_limit):
        assert client.get("/api/v1/tags", headers=headers).status_code == 200, f"request {i}"
    for _ in range(20):
        _assert_throttled(client.get("/api/v1/tags", headers=headers))

    # 80 requests went out, 60 were answered. Only those 60 are missing from
    # the account's budget.
    assert _quota_remaining(user) == _READ_QUOTA - per_ip_limit

    # And the budget is genuinely intact: from a fresh address (an empty
    # per-IP bucket) the account reads on, one token per answered request.
    fresh = {**headers, "X-Forwarded-For": "203.0.113.21"}
    assert client.get("/api/v1/tags", headers=fresh).status_code == 200
    assert _quota_remaining(user) == _READ_QUOTA - per_ip_limit - 1


def _request_with_cookie(cookie: str | None) -> Request:
    """A bare Request carrying (or not) a session cookie, for the key func."""
    headers = [(b"cookie", f"{SESSION_COOKIE}={cookie}".encode())] if cookie else []
    return Request({"type": "http", "headers": headers})


def test_read_quota_key_follows_the_account_not_the_session(user):
    # Two sessions for one analyst (a second device, or a re-login) share one
    # bucket: the key is the user id, so logging in again can't reset a spent
    # quota the way a session-keyed bucket would.
    first = authenticated_read_key(_request_with_cookie(create_access_token(user)))
    second = authenticated_read_key(_request_with_cookie(create_access_token(user)))
    assert first == second == f"user:{user.id}"


def test_read_quota_key_rejects_a_forged_token(user):
    # Unsigned / tampered / absent cookies all land on the anonymous key, which
    # never accrues. Minting a bucket by hand-writing a `sub` is therefore not
    # a way to escape a spent quota.
    anonymous = authenticated_read_key(_request_with_cookie(None))
    forged = create_access_token(user).rsplit(".", 1)[0] + ".forged-signature"
    assert authenticated_read_key(_request_with_cookie(forged)) == anonymous
    assert authenticated_read_key(_request_with_cookie("not-a-jwt")) == anonymous
    assert anonymous != f"user:{user.id}"


# ── Per-documented-limit coverage: write / auth / admin ────────────────────
# One behavioral check per remaining row of docs/api.md → Rate limits: N
# requests answer, N+1 returns 429. With `_READ_LIMITS` above, every documented
# limit is now pinned, so dropping a `@limiter.limit` from a write endpoint
# fails CI instead of shipping.
#
# The N+1 assertion is itself the proof that all N requests reached the
# limiter: slowapi counts inside the endpoint wrapper, so anything rejected
# earlier (CSRF, request validation, a failing dependency) never accrues and
# the bucket would not be full. Payloads are therefore picked to be cheap
# rather than valid: they clear FastAPI's validation and then fail inside the
# handler (unknown id, unparseable date, unknown invite code, curated tag
# category), so none of them runs an upload or stores evidence.
#
# Cheap is not the same as inert. Four groups still write, and each is reaped
# by a fixture rather than by a later case in the list:
#
# * every case logs in through `_auth`, and `/auth/login` writes an
#   `auth_events` row per attempt, success or failure;
# * `PATCH /users/me` writes a bio onto the throwaway `user` row;
# * every admin action writes an `admin_events` row, and
#   `POST /admin/invite-codes` mints 30 codes;
# * the `reap-*` maintenance cases delete expired `auth_tokens` /
#   `pending_registrations` rows.

_MISSING_ID = uuid.UUID(int=0)

# Multipart submit forms. The date is deliberately unparseable: every submit
# handler parses it first and 422s before touching storage. `files` forces a
# multipart body, which the File(...) parameters require.
_SUBMIT_FORM = {
    "title": "rate limit probe",
    "lat": "0",
    "lng": "0",
    "source_url": "https://example.com/post",
    "source_posted_at": "2026-01-01T00:00",
    "event_date": "not-a-date",
}
_SUBMIT_FILE = {"files": {"file": ("probe.txt", b"probe", "text/plain")}}
# `geolocate` names its optional source uploads `files`, not `file`.
_GEOLOCATE_FILE = {"files": {"files": ("probe.txt", b"probe", "text/plain")}}


class _Case(NamedTuple):
    method: str
    path: str
    limit: int
    # Who calls: "anon" (no session), "user", or "admin".
    role: str = "user"
    # Extra kwargs for the request (json / data / files / params).
    payload: dict[str, Any] | None = None


_DOCUMENTED_LIMITS = [
    # Auth. Anonymous, and CSRF-exempt by design (middleware/csrf.py).
    # `/auth/login` is documented 5/min + 30/hour; the minute tier is the one a
    # test can reach, since exhausting it is the precondition for the hour one.
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
    # Keyed per session, not per IP, so this one also pins that the custom key
    # func is still wired.
    _Case(
        "post",
        "/api/v1/auth/change-password",
        10,
        "user",
        {"json": {"current_password": "wrong-password", "new_password": "password123"}},
    ),
    # Events: the authenticated reads the anonymous suite can't reach.
    _Case(
        "get", "/api/v1/events/possible-duplicates", 60, "user", {"params": {"lat": 0, "lng": 0}}
    ),
    _Case(
        "get",
        "/api/v1/events/import-from-tweet/media",
        60,
        "user",
        {"params": {"u": "https://example.com/photo.jpg"}},
    ),
    _Case("get", f"/api/v1/events/import-archive/{_MISSING_ID}", 60),
    _Case("get", "/api/v1/timeline", 120),
    # Events: writes.
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
    _Case("delete", f"/api/v1/events/{_MISSING_ID}", 30),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/geolocate",
        30,
        "user",
        {"data": _SUBMIT_FORM, **_GEOLOCATE_FILE},
    ),
    # The conflict id resolves to nothing, so the call 400s before it locks or
    # publishes any row.
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
    # Tags / users / social writes.
    _Case(
        "post",
        "/api/v1/tags",
        30,
        "user",
        {"json": {"name": "rate-limit-probe", "category": "capture_source"}},
    ),
    _Case("patch", ME, 30, "user", {"json": {"bio": "probe"}}),
    _Case("post", "/api/v1/users/no-such-user/follow", 60),
    _Case("delete", "/api/v1/users/no-such-user/follow", 60),
    # Admin.
    _Case("post", "/api/v1/admin/invite-codes", 30, "admin", {"json": {}}),
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
    _Case("post", "/api/v1/admin/maintenance/reap-auth-tokens", 30, "admin"),
    _Case("post", "/api/v1/admin/maintenance/reap-pending-registrations", 30, "admin"),
]


# Parametrized over `enumerate` for the same reason as `_READ_LIMITS` above:
# the IP comes from the row's position, so two identical rows can't collapse
# onto one bucket.
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
