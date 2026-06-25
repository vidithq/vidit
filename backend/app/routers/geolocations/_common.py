"""Shared error translation for the geolocations sub-routers.

The typed-error → HTTP envelope used by the ``write`` and ``item`` sub-routers.
Kept here so both import one mapping instead of cross-importing between sibling
routers.
"""

from typing import NoReturn

from fastapi import HTTPException

from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError

_GEOLOCATION_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "tag_requirements_not_met": 400,
    "bounty_not_found": 404,
    "bounty_not_open": 409,
    "invalid_state": 409,
}


def _raise_geolocation_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed geolocations-service error into an HTTP response.

    Same ``{"code", "message"}`` shape as the registration + admin flows so the
    frontend's error renderer treats every business-rule failure alike.
    """
    raise HTTPException(
        status_code=_GEOLOCATION_ERROR_STATUS.get(exc.code, 400),
        detail={"code": exc.code, "message": str(exc)},
    )
