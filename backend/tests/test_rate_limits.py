"""Behavioral tests for the shared slowapi limiter.

conftest's autouse `_disable_rate_limiter` turns the limiter off; these
re-enable it via `live_limiter`. Each test keys its bucket on a unique
X-Forwarded-For IP, so buckets don't bleed between tests.

The docs/api.md -> Rate limits tests compare that section with the limits the routes
carry, so a decorator the docs miss, or a documented limit no route carries, fails here.
`_READ_LIMITS` and `_DOCUMENTED_LIMITS` send N+1 requests to the limits they pin.
"""

from __future__ import annotations

import fnmatch
import json
import re
import uuid
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from fastapi.routing import APIRoute
from slowapi.wrappers import Limit
from starlette.requests import Request

from app.main import (
    RATE_LIMITED_CODE,
    READ_QUOTA_EXCEEDED_CODE,
    app,
)
from app.models.tag import Tag
from app.models.user import User
from app.ratelimit import (
    AUTHENTICATED_READ_LIMIT,
    AUTHENTICATED_READ_SCOPE,
    authenticated_read_key,
)
from app.services.auth import create_access_token, hash_password
from app.services.auth_cookies import SESSION_COOKIE
from app.services.sanitize import html_from_text
from tests._fixtures import client
from tests.conftest import login_as
from tests.events._helpers import WORLD_BBOX

ME = "/api/v1/users/me"
_ORG = "/api/v1/organizations/no-such-org"


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


def _auth(regular_user: User, ip: str) -> dict[str, str]:
    # The XFF IP pins this caller to its own bucket (rate_limit_key reads the
    # right-most entry).
    return {**login_as(client, regular_user), "X-Forwarded-For": ip}


def _assert_throttled(resp, code: str = RATE_LIMITED_CODE) -> None:
    # The code separates a per-endpoint throttle from the hour-long read quota.
    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == code
    assert int(resp.headers["Retry-After"]) >= 1


def test_write_limit_returns_429_after_quota(live_limiter, regular_user):
    headers = _auth(regular_user, "203.0.113.10")  # update_my_profile is 30/minute
    for i in range(30):
        resp = client.patch(ME, json={"bio": f"n{i}"}, headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    _assert_throttled(client.patch(ME, json={"bio": "over"}, headers=headers))


def test_limit_is_per_endpoint_not_a_global_floor(live_limiter, regular_user):
    # Exhaust the 30/min write bucket; another endpoint on the same IP still
    # answers (no global floor).
    headers = _auth(regular_user, "203.0.113.11")
    for _ in range(30):
        assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 200
    assert client.patch(ME, json={"bio": "x"}, headers=headers).status_code == 429
    profile = client.get(f"/api/v1/users/{regular_user.username}", headers=headers)  # 120/min
    assert profile.status_code == 200


def test_disabled_limiter_never_blocks(regular_user):
    # No `live_limiter`: the autouse fixture leaves the limiter disabled.
    headers = _auth(regular_user, "203.0.113.12")
    statuses = {
        client.patch(ME, json={"bio": f"n{i}"}, headers=headers).status_code for i in range(35)
    }
    assert statuses == {200}


def test_shared_limiter_fires_on_a_second_router(live_limiter, regular_user, db):
    # The shared limiter also enforces on the tags router. Same-name creates
    # are idempotent (first 201, then 200), so one row exists.
    headers = _auth(regular_user, "203.0.113.13")  # create_tag is 30/minute
    name = f"rl-{uuid.uuid4().hex[:8]}"
    try:
        for i in range(30):
            r = client.post("/api/v1/tags", json={"name": name}, headers=headers)
            assert r.status_code in (200, 201), f"request {i} was {r.status_code}"
        blocked = client.post("/api/v1/tags", json={"name": name}, headers=headers)
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
    ("/api/v1/search/sections?q=vidit", 60),
    ("/api/v1/search/dates?q=vidit", 60),
    ("/api/v1/search/authors?q=vidit", 60),
    ("/api/v1/tags", 60),
    ("/api/v1/conflicts", 60),
    ("/api/v1/users/no-such-user", 120),
    ("/api/v1/users/no-such-user/events", 120),
    ("/api/v1/users/no-such-user/stats", 120),
    ("/api/v1/users/no-such-user/collections", 120),
    (f"/api/v1/collections/{uuid.UUID(int=0)}", 120),
    (f"/api/v1/collections/{uuid.UUID(int=0)}/events", 120),
    ("/api/v1/users/no-such-user/organizations", 120),
    (f"/api/v1/sites?bbox={WORLD_BBOX}", 60),
    (f"/api/v1/sites/{uuid.UUID(int=0)}", 120),
    (f"/api/v1/sites/{uuid.UUID(int=0)}/versions", 120),
    (f"/api/v1/sites/{uuid.UUID(int=0)}/versions/1", 120),
    (f"/api/v1/events/{uuid.UUID(int=0)}/site-links", 120),
    (_ORG, 120),
    (f"{_ORG}/members", 120),
    (f"{_ORG}/approvals", 120),
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


def test_documented_detections_queue_limit(live_limiter, regular_user):
    # The one non-anonymous read in the table (120/min).
    headers = _auth(regular_user, "198.51.100.120")
    for i in range(120):
        resp = client.get("/api/v1/events/detections", headers=headers)
        assert resp.status_code == 200, f"request {i} was {resp.status_code}"
    assert client.get("/api/v1/events/detections", headers=headers).status_code == 429


# 1000/hour keyed by ``User.id``, one bucket for the whole read surface.

_READ_QUOTA = int(AUTHENTICATED_READ_LIMIT.split("/")[0])


def _route_limits() -> dict[tuple[str, str], list[Limit]]:
    """Every (method, path template) the limiter decorates, with its limits in registration order."""
    found: dict[tuple[str, str], list[Limit]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        name = f"{route.endpoint.__module__}.{route.endpoint.__name__}"
        limits = app.state.limiter._route_limits.get(name)
        if limits:
            for method in route.methods:
                found[(method, route.path)] = limits
    return found


_QUOTA_ROUTES = sorted(
    key
    for key, limits in _route_limits().items()
    if any(lim.scope == AUTHENTICATED_READ_SCOPE for lim in limits)
)


@pytest.mark.parametrize("route", _QUOTA_ROUTES, ids=[" ".join(r) for r in _QUOTA_ROUTES])
def test_quota_registers_after_the_per_ip_limit(route):
    # The per-IP limit (scope `""`) must register first so a rejected request
    # never spends the account's hourly budget.
    scopes = [lim.scope for lim in _route_limits()[route]]
    assert scopes == ["", AUTHENTICATED_READ_SCOPE]


# docs/api.md -> Rate limits is the one statement of each limit: its table and its quota list
# must name exactly the routes the code decorates, with the same limits.

_API_DOC = Path(__file__).resolve().parents[2] / "docs" / "api.md"
_METHOD = re.compile(r"^(GET|POST|PUT|PATCH|DELETE)$")
_DOC_LIMIT = re.compile(r"(\d+)/(min|hour)")


def _rate_limit_section() -> tuple[str, str]:
    text = _API_DOC.read_text()
    section = text.split("\n## Rate limits\n", 1)[1].split("\n## ", 1)[0]
    table, quota = section.split("\n### Per-user read quota\n", 1)
    return table, quota


def _doc_routes(cell: str, default_method: str | None = None) -> list[tuple[str, str]]:
    """The (method, path pattern) pairs a cell names: `PUT`/`DELETE /x` names two, and a bare
    path takes `default_method`. Path parameters become `{}`, `*` stays a wildcard."""
    routes: list[tuple[str, str]] = []
    pending: list[str] = []
    for token in re.findall(r"`([^`]+)`", cell):
        if _METHOD.match(token):
            pending.append(token)
            continue
        method, _, path = token.rpartition(" ")
        methods = [*pending, method] if method else [default_method or ""]
        pending = []
        pattern = "/api/v1" + re.sub(r"\{[^}]+\}", "{}", path)
        routes.extend((m, pattern) for m in methods)
    return routes


def _code_key(method: str, path: str) -> tuple[str, str]:
    return method, re.sub(r"\{[^}]+\}", "{}", path)


def _match(patterns: dict[tuple[str, str], Any], key: tuple[str, str]) -> list[tuple[str, str]]:
    return [p for p in patterns if p[0] == key[0] and fnmatch.fnmatchcase(key[1], p[1])]


@pytest.mark.skipif(not _API_DOC.is_file(), reason="the docs tree is not checked out")
def test_rate_limit_table_matches_the_decorators():
    table, _ = _rate_limit_section()
    documented: dict[tuple[str, str], list[str]] = {}
    for row in table.splitlines():
        cells = [c.strip() for c in row.strip("|").split("|")]
        if not row.startswith("| `") or len(cells) != 2:
            continue
        unit = {"min": "minute", "hour": "hour"}
        limits = [f"{n} per 1 {unit[u]}" for n, u in _DOC_LIMIT.findall(cells[1])]
        for key in _doc_routes(cells[0]):
            documented[key] = limits

    code = {
        _code_key(*key): [str(lim.limit) for lim in limits if lim.scope != AUTHENTICATED_READ_SCOPE]
        for key, limits in _route_limits().items()
    }
    undocumented = [key for key in code if len(_match(documented, key)) != 1]
    assert undocumented == [], "limited routes missing from the docs/api.md table"
    unknown = [p for p in documented if not any(_match({p: None}, key) for key in code)]
    assert unknown == [], "docs/api.md table rows that no route carries"
    wrong = {key: code[key] for key in code if documented[_match(documented, key)[0]] != code[key]}
    assert wrong == {}, "limits that differ from docs/api.md"


@pytest.mark.skipif(not _API_DOC.is_file(), reason="the docs tree is not checked out")
def test_read_quota_list_matches_the_decorators():
    _, quota = _rate_limit_section()
    paragraph = next(line for line in quota.splitlines() if line.startswith("`GET "))
    documented = sorted(_doc_routes(paragraph, default_method="GET"))
    count = re.search(r"these (\d+) read paths", quota)
    assert count is not None
    assert documented == sorted(_code_key(*key) for key in _QUOTA_ROUTES)
    assert int(count.group(1)) == len(documented)


# Two cheap 404 reads on different routers: alternating proves one shared budget.
_QUOTA_PATHS = ("/api/v1/users/no-such-user", f"/api/v1/events/{uuid.UUID(int=0)}")


def _rotating_ip(i: int) -> str:
    # A fresh address per request, so only the per-user quota can answer 429.
    # 198.18.0.0/15 is the reserved benchmarking range.
    return f"198.18.{i // 256}.{i % 256}"


def test_read_quota_walls_an_account_across_endpoints_and_ips(live_limiter, regular_user, db):
    headers = login_as(client, regular_user)
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


def _quota_remaining(regular_user: User) -> int:
    """Tokens left in ``user``'s hourly read bucket, read from the store."""
    limits = app.state.limiter._route_limits["app.routers.tags.list_tags"]
    item = next(lim.limit for lim in limits if lim.scope == AUTHENTICATED_READ_SCOPE)
    _reset_at, remaining = app.state.limiter.limiter.get_window_stats(
        item, f"user:{regular_user.id}", AUTHENTICATED_READ_SCOPE
    )
    return remaining


def test_per_ip_rejection_does_not_charge_the_read_quota(live_limiter, regular_user):
    # Requests rejected by the per-minute limit (`GET /tags`, 60/min per IP)
    # must not cost hourly budget.
    per_ip_limit = 60
    headers = _auth(regular_user, "203.0.113.20")
    for i in range(per_ip_limit):
        assert client.get("/api/v1/tags", headers=headers).status_code == 200, f"request {i}"
    for _ in range(20):
        _assert_throttled(client.get("/api/v1/tags", headers=headers))

    assert _quota_remaining(regular_user) == _READ_QUOTA - per_ip_limit

    fresh = {**headers, "X-Forwarded-For": "203.0.113.21"}
    assert client.get("/api/v1/tags", headers=fresh).status_code == 200
    assert _quota_remaining(regular_user) == _READ_QUOTA - per_ip_limit - 1


def _request_with_cookie(cookie: str | None) -> Request:
    """A bare Request carrying (or not) a session cookie."""
    headers = [(b"cookie", f"{SESSION_COOKIE}={cookie}".encode())] if cookie else []
    return Request({"type": "http", "headers": headers})


def test_read_quota_key_follows_the_account_not_the_session(regular_user):
    # The key is the user id, so a second session can't reset a spent quota.
    first = authenticated_read_key(_request_with_cookie(create_access_token(regular_user)))
    second = authenticated_read_key(_request_with_cookie(create_access_token(regular_user)))
    assert first == second == f"user:{regular_user.id}"


def test_read_quota_key_rejects_a_forged_token(regular_user):
    # Unsigned, tampered, or absent cookies land on the anonymous key, so a
    # hand-written `sub` can't mint a fresh bucket.
    anonymous = authenticated_read_key(_request_with_cookie(None))
    forged = create_access_token(regular_user).rsplit(".", 1)[0] + ".forged-signature"
    assert authenticated_read_key(_request_with_cookie(forged)) == anonymous
    assert authenticated_read_key(_request_with_cookie("not-a-jwt")) == anonymous
    assert anonymous != f"user:{regular_user.id}"


# N requests answer, N+1 returns 429. The N+1 assertion also proves all N
# reached the limiter: slowapi counts inside the endpoint wrapper, so requests
# rejected earlier (CSRF, validation, a failing dependency) never accrue.
# Payloads therefore clear validation and fail inside the handler (unknown id,
# unparseable date, unknown invite code), so none stores evidence.
#
# Some groups still write, each reaped by a fixture:
# * `/auth/login` writes an `audit_log` row per attempt;
# * `PATCH /users/me`, `PATCH /users/me/preferences`, `POST /notifications/read` and
#   `DELETE /users/me/avatar` touch the throwaway `user` row;
# * admin actions write `audit_log` rows, `POST /admin/invite-codes`
#   mints 30 codes;
# * `POST /collections` opens 30 collections and `POST /sites` 30 sites (both dropped by the
#   owner cascade);
# * the `reap-*` cases delete expired `password_reset_tokens` / `pending_registrations`.

_MISSING_ID = uuid.UUID(int=0)

_PROBE_ZONE = {
    "type": "Polygon",
    "coordinates": [[[-150.0, -60.0], [-149.99, -60.0], [-149.99, -59.99], [-150.0, -60.0]]],
}
_PROBE_SOURCE = {
    "captured_at": "2025-01-01T00:00:00Z",
    "links": [{"url": "https://earthexplorer.usgs.gov/scene/metadata/full/landsat/probe/"}],
}
_PROBE_SITE = {
    "name": "rate limit probe",
    "kind": "other",
    "contour": _PROBE_ZONE,
    "source": _PROBE_SOURCE,
}

# A well-formed browser subscription; every probe upserts the one row.
# An HTML description, enough to pass body validation.
_PROBE_DESCRIPTION = html_from_text("A probe shelf.")

# The unparseable date makes every submit handler 422 before touching storage.
# `files` forces the multipart body the File(...) parameters require.
_SUBMIT_FORM = {
    "title": "rate limit probe",
    "lat": "0",
    "lng": "0",
    "sources": json.dumps([{"level": "direct", "links": [{"url": "https://example.com/post"}]}]),
    "occurred_date": "not-a-date",
}
_SUBMIT_FILE = {"files": {"proof_files": ("probe.txt", b"probe", "text/plain")}}


class _Case(NamedTuple):
    method: str
    path: str
    limit: int
    # "anon", "user", "user_minting_off", or "admin".
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
    _Case("get", "/api/v1/feed", 120),
    _Case("get", "/api/v1/feed/dates", 120),
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
        f"/api/v1/events/{_MISSING_ID}/versions",
        30,
        "user",
        {"data": _SUBMIT_FORM, **_SUBMIT_FILE},
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
                        "kind": "smartphone",
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
        {"json": {"name": "rate-limit-probe"}},
    ),
    # The `text/plain` probe is rejected before any storage write.
    _Case(
        "post",
        "/api/v1/uploads",
        30,
        "user",
        {"files": {"file": ("probe.txt", b"probe", "text/plain")}},
    ),
    # An unsupported link is refused before any fetch.
    _Case(
        "post",
        "/api/v1/uploads/from-link",
        30,
        "user",
        {"json": {"url": "https://example.com/probe"}},
    ),
    # An unknown event's image is refused before any storage read.
    _Case(
        "post",
        "/api/v1/uploads/from-proof",
        30,
        "user",
        {"json": {"event_id": str(_MISSING_ID), "url": "https://example.com/probe.jpg"}},
    ),
    _Case("post", "/api/v1/sources/check", 120, "user", {"json": {"kind": "satellite"}}),
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
    _Case("get", f"{ME}/preferences", 120),
    _Case("patch", f"{ME}/preferences", 60, "user", {"json": {"display": {"theme": "dark"}}}),
    _Case("get", f"{ME}/x-handle", 120),
    _Case("get", f"{ME}/invite-codes", 120),
    # Minting is off for the probe account, so no request mints or meets the daily quota.
    _Case("post", f"{ME}/invite-codes", 30, "user_minting_off", {"json": {"x_handle": "rl_probe"}}),
    _Case("post", f"{ME}/invite-codes/{_MISSING_ID}/revoke", 30),
    _Case("get", "/api/v1/notifications", 120),
    _Case("get", "/api/v1/notifications/unread-count", 120),
    _Case(
        "post",
        "/api/v1/notifications/read",
        60,
        "user",
        {"json": {"ids": [str(_MISSING_ID)]}},
    ),
    _Case("delete", f"/api/v1/notifications/{_MISSING_ID}", 60),
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
    # The site create stores a row per request; the other probes 404 after the limiter.
    _Case("post", "/api/v1/sites", 30, "user", {"json": _PROBE_SITE}),
    _Case("post", "/api/v1/sites/overlaps", 60, "user", {"json": {"zone": _PROBE_ZONE}}),
    _Case("post", f"/api/v1/sites/{_MISSING_ID}/sources", 30, "user", {"json": _PROBE_SOURCE}),
    _Case("delete", f"/api/v1/sites/{_MISSING_ID}/sources/{_MISSING_ID}", 30),
    _Case(
        "post",
        f"/api/v1/sites/{_MISSING_ID}/versions",
        30,
        "user",
        {"json": {"version_no": 1, "name": "probe", "kind": "depot"}},
    ),
    _Case("post", f"/api/v1/sites/{_MISSING_ID}/report", 10, "anon", {"json": {"reason": "other"}}),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/site-links",
        60,
        "user",
        {"json": {"site_id": str(_MISSING_ID), "effect": "damage"}},
    ),
    _Case("delete", f"/api/v1/events/{_MISSING_ID}/site-links/{_MISSING_ID}", 60),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/site-suggestions", 120),
    _Case("get", "/api/v1/sites/suggestions", 120),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/geolocator-invites", 120),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/geolocator-invites",
        30,
        "user",
        {"json": {"username": "probe"}},
    ),
    _Case("delete", f"/api/v1/events/{_MISSING_ID}/geolocator-invites/probe", 30),
    _Case("post", f"/api/v1/events/{_MISSING_ID}/geolocator-invites/accept", 60),
    _Case("post", f"/api/v1/events/{_MISSING_ID}/geolocator-invites/decline", 60),
    _Case("delete", f"/api/v1/events/{_MISSING_ID}/geolocators/probe", 60),
    _Case("patch", _ORG, 30, "user", {"json": {"bio": "probe"}}),
    _Case(
        "put",
        f"{_ORG}/avatar",
        20,
        "user",
        {"files": {"file": ("probe.txt", b"probe", "text/plain")}},
    ),
    _Case("delete", f"{_ORG}/avatar", 20),
    _Case("get", f"{_ORG}/invites", 60),
    _Case("get", f"{_ORG}/invite-candidates", 60),
    _Case("get", f"{_ORG}/approval-requests", 60),
    _Case("post", f"{_ORG}/invites", 30, "user", {"json": {"username": "nobody"}}),
    _Case("delete", f"{_ORG}/invites/{_MISSING_ID}", 60),
    _Case("post", f"{_ORG}/invite/accept", 30),
    _Case("post", f"{_ORG}/invite/decline", 30),
    _Case("patch", f"{_ORG}/members/nobody", 60, "user", {"json": {"role": "member"}}),
    _Case("delete", f"{_ORG}/members/nobody", 60),
    # The named first admin does not exist, so the create 404s after the limiter.
    _Case(
        "post",
        "/api/v1/admin/organizations",
        30,
        "admin",
        {"json": {"name": "Probe", "slug": "probe-org", "manager_username": "nobody-at-all"}},
    ),
    _Case("delete", "/api/v1/admin/organizations/no-such-org", 30, "admin"),
    _Case(
        "post",
        "/api/v1/admin/organizations/no-such-org/managers",
        30,
        "admin",
        {"json": {"username": "nobody"}},
    ),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/approvals", 120),
    _Case(
        "post", f"/api/v1/events/{_MISSING_ID}/approvals", 60, "user", {"json": {"version_no": 1}}
    ),
    _Case("delete", f"/api/v1/admin/approvals/{_MISSING_ID}", 60, "admin"),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/approval-requests", 120),
    _Case("get", f"/api/v1/events/{_MISSING_ID}/approval-request-targets", 120),
    _Case(
        "post",
        f"/api/v1/events/{_MISSING_ID}/approval-requests",
        30,
        "user",
        {"json": {"username": "probe"}},
    ),
    _Case("post", f"/api/v1/events/{_MISSING_ID}/approval-requests/{_MISSING_ID}/decline", 60),
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
    _Case(
        "patch",
        f"/api/v1/admin/users/{_MISSING_ID}/invite-minting",
        60,
        "admin",
        {"json": {"enabled": False}},
    ),
    _Case("delete", f"/api/v1/admin/users/{_MISSING_ID}", 30, "admin"),
    _Case("delete", f"/api/v1/admin/users/{_MISSING_ID}/detected-events", 30, "admin"),
    _Case("post", f"/api/v1/admin/users/{_MISSING_ID}/restore", 30, "admin"),
    _Case("delete", f"/api/v1/admin/events/{_MISSING_ID}", 60, "admin"),
    _Case("delete", f"/api/v1/admin/collections/{_MISSING_ID}", 60, "admin"),
    _Case(
        "patch",
        f"/api/v1/admin/sites/{_MISSING_ID}/moderation",
        60,
        "admin",
        {"json": {"hidden": True}},
    ),
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
    _Case("post", "/api/v1/admin/maintenance/reap-password-reset-tokens", 30, "admin"),
    _Case("post", "/api/v1/admin/maintenance/reap-pending-registrations", 30, "admin"),
    _Case("post", "/api/v1/notifications/unsubscribe?token=not-a-token", 30, "anon"),
    _Case("get", "/api/v1/notifications/unsubscribe?token=not-a-token", 30, "anon"),
]


@pytest.mark.parametrize(
    ("index", "case"),
    list(enumerate(_DOCUMENTED_LIMITS)),
    ids=[f"{c.method.upper()} {c.path}" for c in _DOCUMENTED_LIMITS],
)
def test_documented_limit_blocks_at_n_plus_1(
    live_limiter, db, regular_user, admin_user, index, case
):
    ip = f"192.0.2.{index + 1}"
    if case.role == "user_minting_off":
        regular_user.is_invite_minting_enabled = False
        db.commit()
    if case.role == "anon":
        headers = {"X-Forwarded-For": ip}
    else:
        headers = _auth(admin_user if case.role == "admin" else regular_user, ip)
    payload = case.payload or {}

    for i in range(case.limit):
        resp = client.request(case.method.upper(), case.path, headers=headers, **payload)
        assert resp.status_code != 429, f"request {i} already 429"
    _assert_throttled(client.request(case.method.upper(), case.path, headers=headers, **payload))
