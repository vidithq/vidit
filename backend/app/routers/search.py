"""``GET /search``: full-text search across geolocations, requests, users.

Single endpoint, single query box, grouped response. See
``services/search.py`` for the FTS plumbing. Anonymous, like the rest of the
read surface; the 60/min per-IP limit is the abuse floor.
"""

from __future__ import annotations

import logging
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.ratelimit import limiter
from app.schemas.search import SearchResponse, SearchTotals, SearchType
from app.services import search as search_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=SearchResponse)
@limiter.limit("60/minute")
def search(
    request: Request,
    q: str = Query("", description="Free-text query (empty returns an empty result set)"),
    type: str = Query(
        "all",
        description="One of 'all', 'geolocation', 'request', 'user'",
    ),
    limit: int = Query(20, ge=1, le=50, description="Per-group cap"),
    db: Session = Depends(get_db),
) -> SearchResponse:
    """Grouped FTS across the three first-class entity types.

    Empty / whitespace-only ``q`` returns an empty response — keeps the
    "user is still typing" hits cheap. The frontend debounces the
    input on its side so we shouldn't see those much in practice, but
    the cheap short-circuit is robust against accidental load.
    """
    if type not in search_service.ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=(f"type must be one of: {', '.join(sorted(search_service.ALLOWED_TYPES))}"),
        )

    types = search_service.types_from_param(type)
    grouped = search_service.search_all(db, query=q, types=types, limit=limit)

    # ``total`` is the pre-LIMIT match count from ``COUNT(*) OVER ()``,
    # so it can exceed ``len(hits)`` — the UI uses this to render "N of M"
    # truthfully ("3 of 142", not "3 of 3").
    return SearchResponse(
        geolocations=grouped["geolocations"]["hits"],
        requests=grouped["requests"]["hits"],
        users=grouped["users"]["hits"],
        total=SearchTotals(
            geolocations=grouped["geolocations"]["total"],
            requests=grouped["requests"]["total"],
            users=grouped["users"]["total"],
        ),
        query=q,
        # The ``type not in ALLOWED_TYPES`` guard above (422 otherwise) proves
        # membership, so the narrowing cast to the Literal is sound.
        type=cast(SearchType, type),
    )
