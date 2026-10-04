"""Shared schema primitives.

``NormalizedEmail`` lowercases every email crossing the API. ``users.email`` is
case-preserving with a case-sensitive UNIQUE, so without it ``admin@vidit.app``
and ``Admin@vidit.app`` would register as two users and ``maybe_promote_admin``
would promote both. Always use it instead of ``EmailStr``.
"""

from typing import Annotated

from pydantic import AfterValidator, EmailStr


def _lowercase(value: str) -> str:
    return value.lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_lowercase)]
