"""``item`` (``/{geolocation_id}``) mounts last, or it shadows the literal-path GETs.

A shadowed literal path would 422 on its non-UUID segment.
"""

from __future__ import annotations

import pytest
from fastapi.routing import APIRoute

from app.main import app
from tests._fixtures import client

_LITERAL_GETS = sorted(
    route.path
    for route in app.routes
    if isinstance(route, APIRoute)
    and route.path.startswith("/api/v1/events/")
    and "{" not in route.path
    and "GET" in route.methods
)


@pytest.mark.parametrize("path", _LITERAL_GETS)
def test_literal_get_routes_are_not_shadowed_by_item(path):
    """A literal-path GET reaches its own handler, not ``GET /{id}`` (which would 422 on the
    path segment)."""
    response = client.get(path)
    errors = response.json().get("detail", []) if response.status_code == 422 else []
    assert not [error for error in errors if error["loc"][0] == "path"], response.text
