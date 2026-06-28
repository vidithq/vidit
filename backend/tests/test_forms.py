"""Unit tests for the shared multipart form-field parsers (``routers/_forms``)."""

from __future__ import annotations

from datetime import time

import pytest
from fastapi import HTTPException

from app.routers._forms import parse_optional_iso_time


def test_parse_optional_iso_time_empty_is_none():
    assert parse_optional_iso_time("", field="event_time") is None
    assert parse_optional_iso_time(None, field="event_time") is None


def test_parse_optional_iso_time_parses_naive():
    assert parse_optional_iso_time("14:30", field="event_time") == time(14, 30)


def test_parse_optional_iso_time_rejects_garbage():
    with pytest.raises(HTTPException) as exc:
        parse_optional_iso_time("not-a-time", field="event_time")
    assert exc.value.status_code == 422


def test_parse_optional_iso_time_rejects_offset_aware():
    # An offset-aware time can't be normalised to UTC without a date, so it's
    # rejected rather than silently stored with the offset dropped.
    with pytest.raises(HTTPException) as exc:
        parse_optional_iso_time("14:30+02:00", field="event_time")
    assert exc.value.status_code == 422
