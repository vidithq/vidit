"""Shared pytest fixtures and helpers.

slowapi's in-memory limiter is process-level state, and TestClient uses
``testclient`` as the remote address for every request, so a per-router limit
would spill between tests and produce spurious 429s. The autouse fixture below
disables the single shared limiter so tests stay deterministic; the rate-limit
tests re-enable it explicitly.

Parallel runs (pytest-xdist) get one database per worker: the controller
migrates a template database to alembic head once, and each worker clones it.
A serial run uses the DATABASE_URL database as-is. The rewrite below runs at
import time because ``app.database`` binds its engine at import.
"""

from __future__ import annotations

import os
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
# Set by the controller and inherited by workers, so all agree on the base URL.
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
from app.services.tweet_ingest import retry  # noqa: E402

TEST_CSRF_TOKEN = "test-csrf-token"

# Serializes worker clones: Postgres refuses concurrent CREATE DATABASE from one template.
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
    """The template's alembic revision, or None when missing or pre-baseline."""
    try:
        with psycopg2.connect(template_url) as conn, conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version")
            row = cur.fetchone()
            return row[0] if row else None
    except psycopg2.Error:
        return None


def _refresh_template(base_url: str) -> None:
    """Build the template database at alembic head, or reuse it when its revision is current."""
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
        # Worker: clone the controller's template (DATABASE_URL was rewritten at import).
        _create_worker_db(os.environ[_BASE_URL_ENV], _XDIST_WORKER)
    elif getattr(config.option, "numprocesses", None):
        # xdist controller: publish the base URL to workers, refresh the template.
        from app.config import settings

        os.environ[_BASE_URL_ENV] = settings.database_url
        _refresh_template(settings.database_url)


def login_as(client: TestClient, user: User) -> dict[str, str]:
    """Set the session and CSRF cookies on ``client`` for ``user``; return the
    ``X-CSRF-Token`` header dict to echo on mutating calls.

    Skips the ``/auth/login`` round-trip. The JWT carries the current
    ``token_version``, so bumping it afterwards invalidates the cookie.
    """
    token = create_access_token(user)
    client.cookies.set(SESSION_COOKIE, token)
    client.cookies.set(CSRF_COOKIE, TEST_CSRF_TOKEN)
    return {CSRF_HEADER: TEST_CSRF_TOKEN}


@pytest.fixture(autouse=True)
def retry_sleeps(monkeypatch):
    """Record the ingest retry sleeps (``retry.BACKOFF_S``) instead of waiting.

    Autouse; request it by name to assert the schedule a fetch spent.
    """
    slept: list[float] = []

    async def sleep_async(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(retry, "_sleep", slept.append)
    monkeypatch.setattr(retry, "_sleep_async", sleep_async)
    return slept


@pytest.fixture(autouse=True)
def _disable_rate_limiter():
    limiter = app.state.limiter
    previous = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = previous
