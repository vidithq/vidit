"""The standard event filter set (``services/event_filters.EventFilters``) as query parameters,
one dependency for every read that lists events."""

from fastapi import Query

from app.services.event_filters import (
    AUTHOR_FILTER_PATTERN,
    EventFilters,
    validate_media_types,
    validate_source_filters,
)


def event_filters(
    # List params take multiple values (?tag=a&tag=b), any-match within a list.
    conflict: list[str] | None = Query(None),
    source_kind: list[str] | None = Query(None),
    level: list[str] | None = Query(None),
    tag: list[str] | None = Query(None),
    occurred_date_from: str | None = None,
    occurred_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = Query(
        None,
        pattern=AUTHOR_FILTER_PATTERN,
        description="Keep the events credited to this username (exact, case-insensitive); on"
        " search, also the sites and collections it owns",
    ),
    media: list[str] | None = Query(None),
    approved: bool = Query(False, description="Keep events approved on their live version"),
    approved_by: str | None = Query(
        None,
        pattern=AUTHOR_FILTER_PATTERN,
        description="Keep events this analyst approved on their live version (username)",
    ),
    approved_by_org: str | None = Query(
        None,
        pattern=AUTHOR_FILTER_PATTERN,
        description="Keep events this organization approved on their live version (slug)",
    ),
    has_coords: bool | None = Query(None, description="true: with a location; false: without"),
) -> EventFilters:
    """The filter set, ``status`` left unset; 422 on a value outside its domain. Dates are
    parsed when the filters apply (``services/event_filters.apply_filters``)."""
    validate_media_types(media)
    validate_source_filters(source_kind, level)
    return EventFilters(
        conflict=conflict,
        source_kind=source_kind,
        level=level,
        tag=tag,
        occurred_date_from=occurred_date_from,
        occurred_date_to=occurred_date_to,
        submitted_from=submitted_from,
        submitted_to=submitted_to,
        author=author,
        media=media,
        approved=approved,
        approved_by=approved_by,
        approved_by_org=approved_by_org,
        has_coords=has_coords,
    )
