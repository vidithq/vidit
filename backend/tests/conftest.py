"""Shared pytest fixtures and helpers.

slowapi's in-memory limiter is module-level state shared across the whole
process; TestClient uses ``testclient`` as the remote address for every
request, so without resetting between tests the 5-per-minute /login limit
spills from one test into the next and produces spurious 429s. Reset the
limiter before each test to make rate-limit-sensitive tests deterministic.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.routers import bounties as bounties_router
from app.routers import geolocations as geolocations_router
from app.routers import search as search_router
from app.services.auth import create_access_token
from app.services.auth_cookies import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE

TEST_CSRF_TOKEN = "test-csrf-token"


def login_as(client: TestClient, user: User) -> dict[str, str]:
    """Set the session + CSRF cookies on ``client`` for ``user``; return
    the ``X-CSRF-Token`` header dict to echo on mutating calls.

    Equivalent to a successful ``POST /auth/login`` for the user, but skips
    the round-trip — tests that aren't exercising the login flow shouldn't
    pay for it. The minted JWT embeds the user's current ``token_version``
    in the ``tv`` claim (the session-lifecycle invalidation mechanism),
    so refreshing the row's ``token_version`` after this call invalidates
    the cookie at the next request — exactly the production semantics.
    The CSRF token is a fixed test value; the helper sets the cookie and
    returns the matching header so the middleware sees a valid double-
    submit pair.
    """
    token = create_access_token(user)
    client.cookies.set(SESSION_COOKIE, token)
    client.cookies.set(CSRF_COOKIE, TEST_CSRF_TOKEN)
    return {CSRF_HEADER: TEST_CSRF_TOKEN}


@pytest.fixture(autouse=True)
def _disable_rate_limiter():
    # slowapi's per-process counters carry across tests and TestClient always
    # reports the same remote address, so a 5-per-minute /login limit pollutes
    # other tests. Disable wholesale here; rate-limit behaviour gets its own
    # focused coverage elsewhere if/when needed. Each router carries its own
    # Limiter instance (the app default in main.py + the per-router auth /
    # admin ones) — disable them all.
    limiters = [
        getattr(app.state, "limiter", None),
        auth_router.limiter,
        admin_router.limiter,
        bounties_router.limiter,
        geolocations_router.limiter,
        search_router.limiter,
    ]
    previous = [(lim, getattr(lim, "enabled", None)) for lim in limiters if lim]
    for lim, _ in previous:
        lim.enabled = False
    yield
    for lim, prev in previous:
        if prev is not None:
            lim.enabled = prev
