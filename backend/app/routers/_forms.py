"""Multipart form-field parsers shared by the event write routers."""

import json
import uuid
from datetime import time

from fastapi import HTTPException

# The date parser lives in ``services.event_filters`` (its heaviest consumer);
# re-exported so the submit forms keep one import site.
from app.services.event_filters import (
    parse_optional_iso_date as parse_optional_iso_date,
)

# Cap on a JSON-array form field (tag_ids / conflict_ids):
# bounds an attacker-sized array, which would become an unbounded SQL IN clause.
MAX_ID_LIST_LENGTH = 100


def parse_json_id_list(raw: str | None, *, field: str) -> list[uuid.UUID]:
    """``None`` or empty is ``[]``; 400 on invalid JSON or a non-array, 422 past
    :data:`MAX_ID_LIST_LENGTH` items or on a non-UUID."""
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
    try:
        return [uuid.UUID(str(item)) for item in value]
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"'{field}' must contain only UUIDs") from exc


def parse_optional_iso_time(raw: str | None, *, field: str) -> time | None:
    """Parse an optional ISO-8601 (HH:MM[:SS]) time-of-day. Empty → ``None``;
    422 on garbage or an offset-aware value.

    The column stores a naive UTC time of day. An offset can't be normalised
    without a date, so it is rejected, not silently dropped.
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
