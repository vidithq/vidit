"""Shared pytest fixtures and helpers.

slowapi's in-memory limiter is process-level state, and TestClient uses
``testclient`` as the remote address for every request, so a per-router limit
would spill between tests and produce spurious 429s. The autouse fixture below
disables the single shared limiter so tests stay deterministic; the rate-limit
tests re-enable it explicitly.

Parallel runs (``pytest -n auto``, pytest-xdist) get one database per worker:
the controller process migrates a template database to alembic head once, and
each worker clones it (``CREATE DATABASE .. TEMPLATE ..``) before the app is
imported, so workers never share mutable state. A serial ``pytest`` run touches
none of this and keeps today's behaviour (the DATABASE_URL database as-is).
The rewrite below runs at import time on purpose: ``app.database`` binds its
engine to ``settings.database_url`` at import, so the env var must be swapped
before any ``app.*`` import.
"""

from __future__ import annotations

import os
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
# Resolved by the controller's pytest_configure and inherited by workers, so
# every process agrees on the base URL even when it comes from a .env file.
_BASE_URL_ENV = "VIDIT_TEST_BASE_DB_URL"


def _swap_db(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{name}"))


def _db_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


def _worker_db_url(base_url: str, worker: str) -> str:
    return _swap_db(base_url, f"{_db_name(base_url)}_test_{worker}")


def _template_db_url(base_url: str) -> str:
    return _swap_db(base_url, f"{_db_name(base_url)}_test_tpl")


if _XDIST_WORKER:
    _base = os.environ.get(
        _BASE_URL_ENV,
        os.environ.get("DATABASE_URL", "postgresql://vision:vision@localhost:5432/vision"),
    )
    os.environ["DATABASE_URL"] = _worker_db_url(_base, _XDIST_WORKER)

import psycopg2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth import create_access_token  # noqa: E402
from app.services.auth_cookies import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE  # noqa: E402

TEST_CSRF_TOKEN = "test-csrf-token"

# Serializes worker clones: Postgres refuses concurrent CREATE DATABASE from
# the same template. Arbitrary but stable app-wide constant.
_CLONE_LOCK_KEY = 74_215_301


def _admin_conn(base_url: str):
    conn = psycopg2.connect(_swap_db(base_url, "postgres"))
    conn.autocommit = True
    return conn


def _alembic_script_head() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    assert head is not None, "no alembic head found; is the cwd backend/?"
    return head


def _template_version(template_url: str) -> str | None:
    """The template's alembic revision, or None when it doesn't exist / is
    empty / predates the alembic baseline."""
    try:
        with psycopg2.connect(template_url) as conn, conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version")
            row = cur.fetchone()
            return row[0] if row else None
    except psycopg2.Error:
        return None


def _refresh_template(base_url: str) -> None:
    """Build (or reuse) the template database at alembic head.

    Reuse is keyed on the alembic revision: an up-to-date template makes the
    controller's setup a single SELECT; a stale one is dropped and rebuilt.
    """
    template_url = _template_db_url(base_url)
    if _template_version(template_url) == _alembic_script_head():
        return
    template = _db_name(template_url)
    # No ``with conn:`` around DDL: psycopg2's connection context manager
    # wraps a transaction block even on an autocommit connection, and
    # DROP/CREATE DATABASE refuse to run inside one.
    conn = _admin_conn(base_url)
    try:
        with conn.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{template}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{template}"')
    finally:
        conn.close()
    conn = psycopg2.connect(template_url)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    finally:
        conn.close()
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": template_url},
        check=True,
        capture_output=True,
    )


def _create_worker_db(base_url: str, worker: str) -> None:
    worker_db = _db_name(_worker_db_url(base_url, worker))
    template = _db_name(_template_db_url(base_url))
    conn = _admin_conn(base_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s)", (_CLONE_LOCK_KEY,))
            try:
                cur.execute(f'DROP DATABASE IF EXISTS "{worker_db}" WITH (FORCE)')
                cur.execute(f'CREATE DATABASE "{worker_db}" TEMPLATE "{template}"')
            finally:
                cur.execute("SELECT pg_advisory_unlock(%s)", (_CLONE_LOCK_KEY,))
    finally:
        conn.close()


def pytest_configure(config: pytest.Config) -> None:
    if _XDIST_WORKER:
        # Worker: clone the template the controller prepared. DATABASE_URL was
        # already rewritten at import time above; the engine only connects at
        # the first test, well after this hook.
        _create_worker_db(os.environ[_BASE_URL_ENV], _XDIST_WORKER)
    elif getattr(config.option, "numprocesses", None):
        # xdist controller: resolve the base URL once (env var or .env via the
        # app settings), publish it to the workers, refresh the template.
        from app.config import settings

        os.environ[_BASE_URL_ENV] = settings.database_url
        _refresh_template(settings.database_url)


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
