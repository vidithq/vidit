"""Authorization checks shared across routers.

Tiny module for the "this row's author must be the caller" idiom, which
recurs on every author-mutating endpoint (geolocation delete, bounty
delete, bounty close). Living in ``services/`` rather than
``dependencies.py`` because FastAPI ``Depends`` factories would force
every caller to also re-resolve the row through the dependency layer —
and several of those resolutions are bespoke (SELECT ... FOR UPDATE for
the bounty-delete race, joinedload sets for the bounty-close response).
The check is just an assertion on already-resolved values; this is the
right shape.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from fastapi import HTTPException, status

from app.models.user import User


class _HasAuthorId(Protocol):
    """Anything carrying a ``UUID`` ``author_id`` column — duck-typed.

    Every domain row we author-gate (Geolocation, Bounty) has the
    column; the Protocol exists so static type-checkers can verify
    callers pass the right shape without us importing both model
    classes here. ``uuid.UUID`` (rather than the looser ``object``)
    rejects the obvious mistake of passing ``user.id`` itself as ``row``.
    """

    author_id: uuid.UUID


def ensure_author(row: _HasAuthorId, user: User) -> None:
    """Raise 403 if ``user`` did not author ``row``.

    No-op on a match. The 403 detail is intentionally generic —
    "Not authorized" — so the response shape stays identical to
    every other permission denial in the API. Soft-delete / not-found
    discrimination is the caller's job: by the time we get here the
    row has already been resolved (the path that fetched it owns the
    404).
    """
    if row.author_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
