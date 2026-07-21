"""Unit tests for the shared multipart form-field parsers (``routers/_forms``)."""

from __future__ import annotations

import json
import uuid
from datetime import time

import pytest
from fastapi import HTTPException

from app.routers._forms import MAX_ID_LIST_LENGTH, parse_json_id_list, parse_optional_iso_time


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


def test_parse_json_id_list_empty_is_empty_list():
    assert parse_json_id_list(None, field="tag_ids") == []
    assert parse_json_id_list("", field="tag_ids") == []


def test_parse_json_id_list_as_uuid_coerces_valid_uuids():
    a, b = uuid.uuid4(), uuid.uuid4()
    raw = json.dumps([str(a), str(b)])
    assert parse_json_id_list(raw, field="tag_ids", as_uuid=True) == [a, b]


def test_parse_json_id_list_as_uuid_rejects_malformed_element():
    # A non-UUID element must 422, not fall through to a psycopg DataError
    # (an uncaught 500) when the caller feeds it into a UUID column.
    raw = json.dumps(["not-a-uuid"])
    with pytest.raises(HTTPException) as exc:
        parse_json_id_list(raw, field="tag_ids", as_uuid=True)
    assert exc.value.status_code == 422


def test_parse_json_id_list_default_keeps_strings():
    # remove_media_ids is compared as strings downstream, so it must not be
    # coerced to UUID even though it looks like one.
    raw = json.dumps(["not-a-uuid", "also-not-a-uuid"])
    assert parse_json_id_list(raw, field="remove_media_ids") == [
        "not-a-uuid",
        "also-not-a-uuid",
    ]


def test_parse_json_id_list_over_cap_rejected():
    raw = json.dumps([str(uuid.uuid4()) for _ in range(MAX_ID_LIST_LENGTH + 1)])
    with pytest.raises(HTTPException) as exc:
        parse_json_id_list(raw, field="tag_ids", as_uuid=True)
    assert exc.value.status_code == 422


def test_parse_json_id_list_over_cap_rejected_without_uuid_coercion():
    # The cap applies regardless of as_uuid (remove_media_ids stays uncapped
    # in element type but not in length).
    raw = json.dumps([str(i) for i in range(MAX_ID_LIST_LENGTH + 1)])
    with pytest.raises(HTTPException) as exc:
        parse_json_id_list(raw, field="remove_media_ids")
    assert exc.value.status_code == 422


def test_parse_json_id_list_at_cap_is_allowed():
    raw = json.dumps([str(uuid.uuid4()) for _ in range(MAX_ID_LIST_LENGTH)])
    result = parse_json_id_list(raw, field="tag_ids", as_uuid=True)
    assert len(result) == MAX_ID_LIST_LENGTH
