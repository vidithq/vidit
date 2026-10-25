"""Response compression: the ``GZipMiddleware`` settings, and bodies gzipped once
and served many times (the ``/points`` cache)."""

import gzip
from typing import NamedTuple

from fastapi import Request
from fastapi.responses import Response

GZIP_MINIMUM_SIZE = 1000
# Starlette defaults to 9. On the world ``/points`` payload level 6 takes about
# half the CPU for 0.5% more bytes, and compression runs on the event loop.
GZIP_LEVEL = 6


class PrecompressedJSON(NamedTuple):
    raw: bytes
    # ``None`` under ``GZIP_MINIMUM_SIZE``, where the middleware sends it raw too.
    gzipped: bytes | None


def precompress(raw: bytes) -> PrecompressedJSON:
    if len(raw) < GZIP_MINIMUM_SIZE:
        return PrecompressedJSON(raw, None)
    return PrecompressedJSON(raw, gzip.compress(raw, compresslevel=GZIP_LEVEL))


def precompressed_response(
    request: Request, body: PrecompressedJSON, headers: dict[str, str]
) -> Response:
    """The gzipped bytes when the client takes gzip, else the raw ones.

    ``GZipMiddleware`` passes a response that already has ``Content-Encoding``
    through untouched, so a cache hit costs no compression. It also adds no
    ``Vary`` to it, so the gzipped branch sets its own; the raw branch gets the
    middleware's.
    """
    # The same test as ``GZipMiddleware``.
    if body.gzipped is not None and "gzip" in request.headers.get("accept-encoding", ""):
        return Response(
            content=body.gzipped,
            media_type="application/json",
            headers={**headers, "Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return Response(content=body.raw, media_type="application/json", headers=headers)
