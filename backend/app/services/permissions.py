"""Authorization checks shared across routers.

Lives here, not in ``dependencies.py``: callers resolve the row themselves
(``SELECT ... FOR UPDATE``, joinedload sets), so the check only asserts on
already-resolved values.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from fastapi import HTTPException, status

from app.models.user import User


class _HasOwnerId(Protocol):
    """Anything carrying a ``UUID`` ``owner_id``, duck-typed.

    ``uuid.UUID`` (not ``object``) rejects passing ``user.id`` as ``row``.
    """

    owner_id: uuid.UUID


def ensure_owner(row: _HasOwnerId, user: User) -> None:
    """Raise 403 if ``user`` does not own ``row``; no-op on a match.

    Soft-delete and 404 handling belong to the caller that fetched the row.
    """
    if row.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
