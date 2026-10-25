"""Shared schema primitives.

``NormalizedEmail`` lowercases every email crossing the API. ``users.email`` is
case-preserving with a case-sensitive UNIQUE, so without it ``admin@vidit.app``
and ``Admin@vidit.app`` would register as two users and ``maybe_promote_admin``
would promote both. Always use it instead of ``EmailStr``.

``UsernameRef`` names an existing account in a request body; the
lookup decides whether it exists.
"""

from typing import Annotated

from pydantic import AfterValidator, EmailStr, Field


def _lowercase(value: str) -> str:
    return value.lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_lowercase)]
UsernameRef = Annotated[str, Field(min_length=1, max_length=50)]
