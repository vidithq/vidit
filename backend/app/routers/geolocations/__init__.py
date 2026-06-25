"""The ``/geolocations`` routers — one ``APIRouter`` per concern.

Each concern (``read`` / ``duplicates`` / ``import_tweet`` / ``write`` /
``item``) owns its own ``APIRouter``; ``main.py`` mounts each under the shared
``/api/v1/geolocations`` prefix.

They're exposed as an **ordered** tuple because the order is load-bearing:
``item`` (``GET /{id}`` and the other ``/{geolocation_id}`` ops) must mount
**last**, or its single-segment catch-all path would shadow the literal-path
GETs (``/points``, ``/possible-duplicates``, ``/import-from-tweet/media``) and
422 on the non-UUID segment.
"""

from app.routers.geolocations import duplicates, import_tweet, item, read, write

routers = (
    read.router,
    duplicates.router,
    import_tweet.router,
    write.router,
    item.router,
)
