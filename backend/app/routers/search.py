"""``GET /search`` — full-text search across geolocations, bounties, users.

Slice 1 of the search feature. Single endpoint, single query box,
grouped response. See ``services/search.py`` for the FTS plumbing and
``docs/next.md`` → *Search* for the roadmap context.

Auth: matches the rest of the read surface for the closed beta —
requires a logged-in user. Phase 3 will likely open this up to
anonymous reads alongside the map.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.search import SearchResponse
from app.services import search as search_service
from app.services.audit import rate_limit_key

logger = logging.getLogger(__name__)

router = APIRouter()

limiter = Limiter(key_func=rate_limit_key)


@router.get("", response_model=SearchResponse)
@limiter.limit("60/minute")
def search(
    request: Request,
    q: str = Query("", description="Free-text query (empty returns an empty result set)"),
    type: str = Query(
        "all",
        description="One of 'all', 'geolocation', 'bounty', 'user'",
    ),
    limit: int = Query(20, ge=1, le=50, description="Per-group cap"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
        bounties=grouped["bounties"]["hits"],
        users=grouped["users"]["hits"],
        total={
            "geolocations": grouped["geolocations"]["total"],
            "bounties": grouped["bounties"]["total"],
            "users": grouped["users"]["total"],
        },
        query=q,
        type=type,
    )
