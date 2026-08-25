"""The coordinate bounds check and the optional point the write forms build."""

from __future__ import annotations

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from .errors import InvalidCoordinatesError


def validate_coordinates(lat: float, lng: float) -> None:
    """Reject out-of-range coordinates: the single bounds check shared by the
    human create + geolocate paths."""
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")


def _optional_point(lat: float | None, lng: float | None, *, field: str):
    """Validate + build an optional PostGIS point from a half-typed form pair.

    A lone half of the pair is a client bug, not a droppable value, so reject it
    rather than silently storing nothing.
    """
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise InvalidCoordinatesError(f"{field} requires both a latitude and a longitude")
    validate_coordinates(lat, lng)
    return from_shape(Point(lng, lat), srid=4326)
