"""Multipart form-field parsers shared by the geolocation + bounty create routers.

Both create endpoints take the same loose ``str`` form fields — a JSON ``proof``
document, a JSON array of ``tag_ids``, and ISO dates — and parse them into clean
Python types. Keeping the parsers here means the ``{status, message}`` contract
for malformed input lives in one place instead of being recopied per form.
"""

import json
from datetime import date
from typing import Any

from fastapi import HTTPException


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


def parse_json_id_list(raw: str | None, *, field: str) -> list[Any]:
    """Parse a JSON-array form field. ``None`` / empty → ``[]``; 400 on garbage."""
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
    return value


def parse_iso_date(raw: str, *, field: str) -> date:
    """Parse a required ISO-8601 (YYYY-MM-DD) date form field; 422 on garbage.

    An empty string is garbage here (→ 422). ``parse_optional_iso_date``
    short-circuits empty to ``None`` before delegating, so only required
    callers reach this with an empty value.
    """
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be an ISO-8601 date (YYYY-MM-DD)"
        ) from exc


def parse_optional_iso_date(raw: str | None, *, field: str) -> date | None:
    """Parse an optional ISO-8601 (YYYY-MM-DD) date form field. Empty → ``None``; 422 on garbage."""
    if not raw:
        return None
    return parse_iso_date(raw, field=field)
