"""``item`` (``/{geolocation_id}``) mounts last, or it shadows the literal-path GETs.

A shadowed literal path would 422 on its non-UUID segment.
"""

from __future__ import annotations

from app.routers.events import (
    batch,
    duplicates,
    import_archive,
    import_tweet,
    item,
    read,
    routers,
    write,
)
from tests.events._helpers import WORLD_BBOX, client


def test_router_mount_order_is_pinned():
    """A re-sort of the router tuple that moves ``item`` off last fails here."""
    assert routers == (
        read.router,
        duplicates.router,
        import_tweet.router,
        import_archive.router,
        write.router,
        batch.router,
        item.router,
    )
    assert routers[-1] is item.router


def test_literal_get_routes_are_not_shadowed_by_item():
    """A literal-path GET reaches its own handler, not ``GET /{id}`` (which would 422)."""
    assert client.get(f"/api/v1/events/points?bbox={WORLD_BBOX}").status_code == 200
    assert client.get("/api/v1/events/possible-duplicates").status_code == 401
