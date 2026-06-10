"""Shared pytest fixtures and helpers.

slowapi's in-memory limiter is process-level state, and TestClient uses
``testclient`` as the remote address for every request, so without a reset the
5-per-minute /login limit spills between tests and produces spurious 429s. The
autouse fixture below resets it so rate-limit-sensitive tests stay deterministic.
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
    """Set the session + CSRF cookies on ``client`` for ``user``; return the
    ``X-CSRF-Token`` header dict to echo on mutating calls.

    Equivalent to a successful ``POST /auth/login`` but skips the round-trip.
    The minted JWT embeds the user's current ``token_version`` in the ``tv``
    claim, so bumping the row's ``token_version`` after this call invalidates
    the cookie at the next request — exactly the production semantics. The CSRF
    token is a fixed test value; the cookie + returned header form a valid
    double-submit pair for the middleware.
    """
    token = create_access_token(user)
    client.cookies.set(SESSION_COOKIE, token)
    client.cookies.set(CSRF_COOKIE, TEST_CSRF_TOKEN)
    return {CSRF_HEADER: TEST_CSRF_TOKEN}


@pytest.fixture(autouse=True)
def _disable_rate_limiter():
    # Disable rate limiting wholesale (rationale in the module docstring). Each
    # router carries its own Limiter instance (app default in main.py + the
    # per-router ones), so disable them all.
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
