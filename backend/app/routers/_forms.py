"""Multipart form-field parsers shared by the geolocation + request create routers.

The ``{status, message}`` contract for malformed ``proof`` JSON, id arrays and
ISO dates / times lives here once instead of per form.
"""

import json
import uuid
from datetime import UTC, datetime, time
from typing import Any

from fastapi import HTTPException

# The date parser lives in ``services.event_filters`` (its heaviest consumer);
# re-exported so the submit forms keep one import site.
from app.services.event_filters import (
    parse_optional_iso_date as parse_optional_iso_date,
)

# Cap on a JSON-array form field (tag_ids / conflict_ids / remove_media_ids):
# bounds an attacker-sized array, which would become an unbounded SQL IN clause.
MAX_ID_LIST_LENGTH = 100


def parse_optional_json_object(raw: str | None, *, field: str) -> dict[str, Any] | None:
    """Parse a JSON-object form field. ``None`` / empty → ``None``; 400 on garbage."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in '{field}': {exc.msg}"
        ) from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail=f"'{field}' must be a JSON object")
    return value


def parse_json_id_list(raw: str | None, *, field: str, as_uuid: bool = False) -> list[Any]:
    """Parse a JSON-array form field. ``None`` / empty → ``[]``; 400 on garbage.

    Capped at :data:`MAX_ID_LIST_LENGTH` (422 over it) since the list feeds a
    SQL ``IN``. With ``as_uuid``, elements are coerced to :class:`uuid.UUID`
    (422 on a non-UUID) for UUID-typed columns; ``remove_media_ids`` is compared
    as a string and leaves it off.
    """
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in '{field}': {exc.msg}"
        ) from exc
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail=f"'{field}' must be a JSON array")
    if len(value) > MAX_ID_LIST_LENGTH:
        raise HTTPException(
            status_code=422, detail=f"'{field}' exceeds the {MAX_ID_LIST_LENGTH}-item limit"
        )
    if not as_uuid:
        return value
    try:
        return [uuid.UUID(str(item)) for item in value]
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"'{field}' must contain only UUIDs") from exc


def parse_optional_iso_time(raw: str | None, *, field: str) -> time | None:
    """Parse an optional ISO-8601 (HH:MM[:SS]) time-of-day. Empty → ``None``;
    422 on garbage or an offset-aware value.

    The column stores a naive UTC time of day. An offset can't be normalised
    without a date, so it is rejected, not silently dropped (unlike
    :func:`parse_iso_datetime`, which has the date).
    """
    if not raw:
        return None
    try:
        parsed = time.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be an ISO-8601 time (HH:MM)"
        ) from exc
    if parsed.tzinfo is not None:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be a UTC time of day with no offset (HH:MM)",
        )
    return parsed


def parse_iso_datetime(raw: str, *, field: str) -> datetime:
    """Parse a required ISO-8601 datetime into an aware UTC datetime; 422 on garbage.

    Forms post ``datetime-local`` values (``YYYY-MM-DDTHH:MM``, no zone), read
    as UTC; an aware value is normalised to UTC.
    """
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be an ISO-8601 datetime (YYYY-MM-DDTHH:MM)",
        ) from exc
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def parse_optional_iso_datetime(raw: str | None, *, field: str) -> datetime | None:
    """Parse an optional ISO-8601 datetime. Empty → ``None``.

    For writes whose row may carry no value (a detection published without a
    resolved source post time), so an edit can leave the column NULL.
    """
    if not raw:
        return None
    return parse_iso_datetime(raw, field=field)
