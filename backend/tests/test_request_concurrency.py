"""The request-concurrency rules (``engineering.md``, Request concurrency).

The API serves every request from one event loop, so a handler that touches the
database is a plain ``def``, which FastAPI runs in its threadpool. The sweep
below keeps an ``async`` one off that loop; ``events/test_geolocate_race.py``
shows what one costs. A lock wait then holds a threadpool worker, so the API
process caps it at ``LOCK_TIMEOUT_MS``, while the scheduler services, which
share the engine but never import ``app.main``, keep waiting.
"""

from __future__ import annotations

import inspect
import subprocess
import sys
from pathlib import Path

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from sqlalchemy import text

from app.database import engine
from app.dependencies import get_db
from app.main import app

# Awaits the raw body for its signature check and keeps its one write inside
# ``run_in_threadpool``.
_ASYNC_BY_DESIGN = {"/api/v1/webhooks/x"}


def _uses_db(dependant: Dependant) -> bool:
    return any(dep.call is get_db or _uses_db(dep) for dep in dependant.dependencies)


def test_no_async_handler_touches_the_database():
    offenders = [
        f"{sorted(route.methods)} {route.path}"
        for route in app.routes
        if isinstance(route, APIRoute)
        and inspect.iscoroutinefunction(route.endpoint)
        and _uses_db(route.dependant)
        and route.path not in _ASYNC_BY_DESIGN
    ]
    assert offenders == []


def test_the_api_engine_caps_lock_waits():
    with engine.connect() as conn:
        assert conn.execute(text("SHOW lock_timeout")).scalar_one() == "5s"


def test_an_engine_outside_the_api_waits_on_locks():
    """A process that imports the engine without ``app.main``, as the scheduler
    services do, opens connections with no lock timeout."""
    probe = (
        "from sqlalchemy import text\n"
        "from app.database import engine\n"
        "with engine.connect() as conn:\n"
        "    print(conn.execute(text('SHOW lock_timeout')).scalar_one())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "0"
