"""``GET /search``: one ranked list of events, sites, collections, analysts and organizations,
``GET /search/sections``: the top of that list for each type, and ``GET /search/dates``: its
events per day.

Anonymous like the rest of the read surface; the 60/min per-IP limit is the
abuse floor. FTS plumbing is in ``services/search.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import DB
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._filters import event_filters
from app.schemas.event import DateHistogram
from app.schemas.search import AuthorSuggestions, SearchResponse, SearchSections
from app.services import search as search_service
from app.services.event_filters import (
    AUTHOR_FILTER_PATTERN,
    EventFilters,
    validate_status_filter,
)
from app.services.pagination import decode_ranked_cursor

router = APIRouter()


@dataclass(frozen=True)
class _SearchRequest:
    q: str
    types: frozenset[str]
    filters: EventFilters


def _search_request(
    q: str = Query("", description="Free-text query"),
    type: list[str] | None = Query(
        None,
        description=(
            "Repeatable: 'event', 'site', 'collection', 'user', 'organization'. Omitted, every type"
        ),
    ),
    status: list[str] | None = Query(None),
    filters: EventFilters = Depends(event_filters),
) -> _SearchRequest:
    """The query, the types and the filters every search read takes, 422 on a value outside its
    domain."""
    unknown = sorted(set(type or ()) - set(search_service.SEARCH_TYPES))
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"type must be one of: {', '.join(search_service.SEARCH_TYPES)}",
        )
    validate_status_filter(status)
    return _SearchRequest(
        q=q,
        types=frozenset(type or search_service.SEARCH_TYPES),
        filters=replace(filters, status=status),
    )


SearchParams = Annotated[_SearchRequest, Depends(_search_request)]


def _suggestion(db: Session, params: _SearchRequest) -> str | None:
    return search_service.spelling_suggestion(
        db, query=params.q, types=params.types, filters=params.filters
    )


@router.get("", response_model=SearchResponse)
@authenticated_read_quota
@limiter.limit("60/minute")
def search(
    request: Request,
    params: SearchParams,
    db: DB,
    limit: int = Query(20, ge=1, le=50, description="Hits per page"),
    cursor: str | None = Query(
        None,
        description=(
            "Opaque `cursor` of a previous response: its next page. Send the query, types and"
            " filters of the request that returned it"
        ),
    ),
) -> SearchResponse:
    """One ranked list of events, sites, collections, analysts and organizations."""
    after = decode_ranked_cursor(cursor)
    page = search_service.search(
        db,
        query=params.q,
        types=params.types,
        limit=limit,
        filters=params.filters,
        after=after,
    )
    suggestion = _suggestion(db, params) if after is None and page.total == 0 else None
    return page.model_copy(update={"suggestion": suggestion})


@router.get("/sections", response_model=SearchSections)
@authenticated_read_quota
@limiter.limit("60/minute")
def search_sections(
    request: Request,
    params: SearchParams,
    db: DB,
    limit: int = Query(5, ge=1, le=10, description="Hits per section"),
) -> SearchSections:
    """The top hits of each type, one section per type with a hit."""
    sections = search_service.search_sections(
        db, query=params.q, types=params.types, limit=limit, filters=params.filters
    )
    return SearchSections(
        sections=sections,
        suggestion=None if sections else _suggestion(db, params),
        query=params.q,
    )


@router.get("/dates", response_model=DateHistogram)
@authenticated_read_quota
@limiter.limit("60/minute")
def search_dates(request: Request, params: SearchParams, db: DB) -> DateHistogram:
    """The events ``GET /search`` lists for the request, counted per day on each date axis."""
    return DateHistogram.model_validate(
        search_service.search_dates(db, query=params.q, types=params.types, filters=params.filters)
    )


@router.get("/authors", response_model=AuthorSuggestions)
@authenticated_read_quota
@limiter.limit("60/minute")
def suggest_authors(
    request: Request,
    db: DB,
    q: str = Query(
        "",
        description="Username fragment; same charset gate as ?author=",
        pattern=r"^$|" + AUTHOR_FILTER_PATTERN,
    ),
) -> AuthorSuggestions:
    """Usernames for the author-filter typeahead."""
    return AuthorSuggestions(authors=search_service.suggest_authors(db, query=q))
