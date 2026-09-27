"""The request-concurrency rule, checked over every mounted route.

The API serves every request from one event loop (``engineering.md``, Request
concurrency), so a handler that touches the database is a plain ``def``, which
FastAPI runs in its threadpool. ``events/test_geolocate_race.py`` shows what
one ``async`` handler on that loop costs; this sweep keeps others from joining
it.
"""

from __future__ import annotations

import inspect

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

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
