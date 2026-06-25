"""Shared typed-error → HTTP envelope for the routers.

Business services raise typed exceptions that each carry a stable ``code``
(:class:`~app.services.evidence_intake.EvidenceIntakeError`,
:class:`~app.services.registration.RegistrationError`,
:class:`~app.services.admin.AdminError` …). Every router maps its own
``code → status`` table but shares this one ``{"code", "message"}`` response
shape, so the frontend's error renderer branches on the stable ``code``
without substring-matching prose.
"""

from typing import NoReturn, Protocol

from fastapi import HTTPException


class CodedError(Protocol):
    """A business error that carries a stable ``code`` for HTTP translation."""

    code: str


def raise_typed_error(exc: CodedError, status_map: dict[str, int]) -> NoReturn:
    """Translate a typed business error into a structured HTTP response.

    Falls back to 400 for an unmapped ``code`` — a new error variant surfaces
    as a generic client error rather than a 500.
    """
    raise HTTPException(
        status_code=status_map.get(exc.code, 400),
        detail={"code": exc.code, "message": str(exc)},
    )
