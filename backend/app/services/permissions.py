"""Authorization checks shared across routers.

The "this row's owner must be the caller" idiom, recurring on every
owner-mutating endpoint (event delete, close, the detected geolocate). In
``services/`` rather than ``dependencies.py`` because ``Depends``
factories would force callers to re-resolve the row through the dependency
layer — and several resolutions are bespoke (SELECT ... FOR UPDATE for the
geolocate race, joinedload sets for the detail response). The check is just
an assertion on already-resolved values.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from fastapi import HTTPException, status

from app.models.user import User


class _HasOwnerId(Protocol):
    """Anything carrying a ``UUID`` ``owner_id`` column — duck-typed.

    Lets type-checkers verify callers pass the right shape without
    importing the concrete ``Event`` model here. ``uuid.UUID``
    (not the looser ``object``) rejects the mistake of passing ``user.id``
    itself as ``row``.
    """

    owner_id: uuid.UUID


def ensure_owner(row: _HasOwnerId, user: User) -> None:
    """Raise 403 if ``user`` does not own ``row``; no-op on a match.

    The 403 detail is generic ("Not authorized") so the response shape
    matches every other permission denial. Soft-delete / not-found
    discrimination is the caller's job — the path that fetched the row
    owns the 404.
    """
    if row.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
