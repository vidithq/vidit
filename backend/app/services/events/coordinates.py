"""Coordinate bounds and the optional PostGIS point the write forms build."""

from __future__ import annotations

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.event import LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN

from .errors import InvalidCoordinatesError


def validate_coordinates(lat: float, lng: float) -> None:
    """Reject out-of-range coordinates. Mirrored by `frontend/src/lib/coordinates.ts`."""
    if not LAT_MIN <= lat <= LAT_MAX:
        raise InvalidCoordinatesError(f"Latitude must be between {LAT_MIN:g} and {LAT_MAX:g}")
    if not LNG_MIN <= lng <= LNG_MAX:
        raise InvalidCoordinatesError(f"Longitude must be between {LNG_MIN:g} and {LNG_MAX:g}")


def _optional_point(lat: float | None, lng: float | None, *, field: str):
    """Build an optional point from a both-or-neither pair; a lone half is rejected."""
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise InvalidCoordinatesError(f"{field} requires both a latitude and a longitude")
    validate_coordinates(lat, lng)
    return from_shape(Point(lng, lat), srid=4326)
