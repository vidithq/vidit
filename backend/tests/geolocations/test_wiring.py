"""Locks the load-bearing mount order of the geolocations sub-routers.

``item`` (the ``/{geolocation_id}`` ops) must mount **last**, or its
single-segment catch-all shadows the literal-path GETs (``/points``,
``/possible-duplicates``, ``/import-from-tweet/media``) and they 422 on the
non-UUID segment. The order is positional in ``routers/geolocations/__init__.py``;
these fail loudly if a future re-sort breaks it.
"""

from __future__ import annotations

from app.routers.geolocations import (
    duplicates,
    import_archive,
    import_tweet,
    item,
    read,
    routers,
    write,
)
from tests.geolocations._helpers import client


def test_router_mount_order_is_pinned():
    """``item`` is last; the literal-path concerns precede it. A tuple re-sort
    (e.g. an innocent-looking alphabetise) trips this before it can ship."""
    assert routers == (
        read.router,
        duplicates.router,
        import_tweet.router,
        import_archive.router,
        write.router,
        item.router,
    )
    assert routers[-1] is item.router


def test_literal_get_routes_are_not_shadowed_by_item():
    """A literal-path GET resolves to its own handler, not ``GET /{id}`` — if
    `item` shadowed it, the non-UUID segment would 422."""
    # Public read: reaches list_points (200), not the /{geolocation_id} 422.
    assert client.get("/api/v1/geolocations/points").status_code == 200
    # Auth-gated: anonymous hits the auth dependency (401), still not the 422
    # that a /{geolocation_id} shadow would produce on the non-UUID segment.
    assert client.get("/api/v1/geolocations/possible-duplicates").status_code == 401
