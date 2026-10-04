"""The ``/events`` routers: one ``APIRouter`` per concern, mounted by
``main.py`` under ``/api/v1/events``.

The tuple order is load-bearing: ``item`` (``GET /{id}`` and the other
``/{geolocation_id}`` ops) must mount **last**, or its single-segment
catch-all would shadow the literal-path GETs (``/points``,
``/possible-duplicates``) and 422 on the non-UUID segment.
"""

from app.routers.events import (
    batch,
    duplicates,
    import_archive,
    import_tweet,
    item,
    read,
    write,
)

routers = (
    read.router,
    duplicates.router,
    import_tweet.router,
    import_archive.router,
    write.router,
    batch.router,
    item.router,
)
