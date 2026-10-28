"""The hand-kept frontend mirrors of backend values (``docs/engineering.md#hand-kept-mirrors``).

Each test reads a constant out of a frontend source file and asserts it equals the backend value
it mirrors, so a change on one side fails here until the other side follows.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

import pytest

from app.models.event import STATUS_CLOSED, TITLE_MAX_LENGTH, EventStatus
from app.models.source import (
    DOCUMENT_SOURCE_KINDS,
    EVIDENCE_LEVELS,
    MAX_LINKS_PER_SOURCE,
    MAX_SOURCES_PER_EVENT,
    SOURCE_TITLE_MAX_LENGTH,
    SOURCE_URL_MAX_LENGTH,
)
from app.schemas.collection import MAX_CREATE_EVENTS
from app.schemas.event import CLOSE_REASON_MAX_LENGTH, VERSION_NOTE_MAX_LENGTH
from app.schemas.report import DETAILS_MAX_LENGTH
from app.services.event_filters import STATUSES
from app.services.events import InvalidCoordinatesError, validate_coordinates
from app.services.geolocator_credit import MAX_EVENT_GEOLOCATORS
from app.services.source_archive import PROVIDER_HOSTS, SNAPSHOT_URL_MAX_LENGTH
from app.services.storage import MAX_GIF_FRAMES

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"

pytestmark = pytest.mark.skipif(
    not FRONTEND_SRC.is_dir(), reason="the frontend tree is not checked out"
)


def _source(path: str) -> str:
    return (FRONTEND_SRC / path).read_text()


def _int(path: str, name: str) -> int:
    match = re.search(rf"\bconst {name} = (-?\d+);", _source(path))
    assert match, f"{name} not found in {path}"
    return int(match.group(1))


def _string(path: str, name: str) -> str:
    match = re.search(rf'\bconst {name} = "([^"]*)";', _source(path))
    assert match, f"{name} not found in {path}"
    return match.group(1)


def _block(path: str, name: str) -> str:
    """The lines of a multi-line constant, from its declaration to the bracket or brace that
    closes it at the start of a line."""
    match = re.search(rf"\bconst {name}\b[^\n]*\n(.*?)\n[\]}}]", _source(path), re.S)
    assert match, f"{name} not found in {path}"
    return match.group(1)


def _strings(path: str, name: str) -> list[str]:
    return re.findall(r'"([^"]+)"', _block(path, name))


@pytest.mark.parametrize(
    ("path", "name", "backend"),
    [
        ("lib/sources.ts", "MAX_SOURCES_PER_EVENT", MAX_SOURCES_PER_EVENT),
        ("lib/sources.ts", "MAX_LINKS_PER_SOURCE", MAX_LINKS_PER_SOURCE),
        ("lib/sources.ts", "SOURCE_TITLE_MAX_LEN", SOURCE_TITLE_MAX_LENGTH),
        ("lib/sources.ts", "SOURCE_URL_MAX_LEN", SOURCE_URL_MAX_LENGTH),
        ("lib/sources.ts", "SOURCE_URL_MAX_LEN", SNAPSHOT_URL_MAX_LENGTH),
        ("lib/events.ts", "EVENT_TITLE_MAX_LEN", TITLE_MAX_LENGTH),
        ("lib/events.ts", "VERSION_NOTE_MAX_LEN", VERSION_NOTE_MAX_LENGTH),
        ("lib/events.ts", "REPORT_DETAILS_MAX_LEN", DETAILS_MAX_LENGTH),
        ("lib/events.ts", "CLOSE_REASON_MAX_LEN", CLOSE_REASON_MAX_LENGTH),
        ("lib/geolocatorCredit.ts", "MAX_EVENT_GEOLOCATORS", MAX_EVENT_GEOLOCATORS),
        ("lib/collections.ts", "BULK_ADD_MAX_EVENTS", MAX_CREATE_EVENTS),
        ("lib/mediaTypes.ts", "MAX_GIF_FRAMES", MAX_GIF_FRAMES),
    ],
)
def test_numeric_caps_match(path: str, name: str, backend: int) -> None:
    assert _int(path, name) == backend


def test_evidence_levels_match() -> None:
    entries = re.findall(r"(\w+): (true|false)", _block("lib/sources.ts", "EVIDENCE_LEVELS"))
    assert [level for level, flag in entries if flag == "true"] == list(EVIDENCE_LEVELS)


def test_document_kinds_match() -> None:
    assert set(_strings("lib/sources.ts", "DOCUMENT_SOURCE_KINDS")) == DOCUMENT_SOURCE_KINDS


def test_snapshot_hosts_and_providers_match() -> None:
    path = "lib/snapshots.ts"
    by_host = {_string(path, "WAYBACK_HOST"): "wayback"}
    by_host |= {host: "archive_today" for host in _strings(path, "ARCHIVE_TODAY_HOSTS")}
    by_host[_string(path, "GHOSTARCHIVE_HOST")] = "ghostarchive"
    assert by_host == PROVIDER_HOSTS
    assert re.search(
        r"SNAPSHOT_HOSTS = \[WAYBACK_HOST, \.\.\.ARCHIVE_TODAY_HOSTS, GHOSTARCHIVE_HOST\]",
        _source(path),
    )


def test_coordinate_bounds_match() -> None:
    path = "lib/coordinates.ts"
    lat_min, lat_max = _int(path, "LAT_MIN"), _int(path, "LAT_MAX")
    lng_min, lng_max = _int(path, "LNG_MIN"), _int(path, "LNG_MAX")
    validate_coordinates(lat_min, lng_min)
    validate_coordinates(lat_max, lng_max)
    for lat, lng in [(lat_min - 1, 0), (lat_max + 1, 0), (0, lng_min - 1), (0, lng_max + 1)]:
        with pytest.raises(InvalidCoordinatesError):
            validate_coordinates(lat, lng)


def test_status_filter_options_match() -> None:
    offered = _strings("components/filters/EventFilterSections.tsx", "FILTER_STATUSES")
    declared = [status for status in get_args(EventStatus) if status != STATUS_CLOSED]
    assert offered == declared
    assert set(offered) == STATUSES - {STATUS_CLOSED}
