"""Shared schema primitives.

``NormalizedEmail`` lowercases every email crossing any API surface. The
``users.email`` column is case-preserving with a case-sensitive UNIQUE in
Postgres, so without this ``admin@vidit.app`` and ``Admin@vidit.app`` register
as two users — and ``maybe_promote_admin`` (``.lower()`` against
``ADMIN_EMAILS``) would auto-promote both. Lowercasing at the schema layer
makes the UNIQUE constraint, login/reset lookups, and the admin allowlist all
see the same canonical form. Always import this instead of ``EmailStr``.
"""

from typing import Annotated

from pydantic import AfterValidator, EmailStr


def _lowercase(value: str) -> str:
    return value.lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_lowercase)]
