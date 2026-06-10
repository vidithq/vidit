"""Shared pytest fixtures and helpers.

slowapi's in-memory limiter is process-level state, and TestClient uses
``testclient`` as the remote address for every request, so a per-router limit
would spill between tests and produce spurious 429s. The autouse fixture below
disables the single shared limiter so tests stay deterministic; the rate-limit
tests re-enable it explicitly.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User
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
    # One shared limiter now (app.ratelimit, exposed as app.state.limiter), so
    # disabling it covers every router. See the module docstring.
    limiter = app.state.limiter
    previous = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = previous
