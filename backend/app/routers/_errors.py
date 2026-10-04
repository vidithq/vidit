"""Shared typed-error → HTTP envelope for the routers.

Services raise typed exceptions carrying a stable ``code``. Each router maps
its own ``code → status`` table but shares this ``{"code", "message"}`` shape,
so the frontend branches on ``code`` without substring-matching prose.
"""

from typing import NoReturn, Protocol

from fastapi import HTTPException


class CodedError(Protocol):
    """A business error that carries a stable ``code`` for HTTP translation."""

    code: str


def raise_typed_error(exc: CodedError, status_map: dict[str, int]) -> NoReturn:
    """Translate a typed business error into a structured HTTP response.

    An unmapped ``code`` falls back to 400, not a 500.
    """
    raise HTTPException(
        status_code=status_map.get(exc.code, 400),
        detail={"code": exc.code, "message": str(exc)},
    )
