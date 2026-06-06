"""Shared schema primitives.

``NormalizedEmail`` is the single point that lowercases every email going
through any API surface. The ``users.email`` column is case-preserving
with a case-sensitive UNIQUE in Postgres, so without this normalization
``admin@vidit.app`` and ``Admin@vidit.app`` register as two distinct
users — and the ``maybe_promote_admin`` allowlist check (``.lower()``
against ``ADMIN_EMAILS``) would auto-promote both. Lowercasing at the
schema layer means the UNIQUE constraint, the login lookup, the reset
lookup and the admin allowlist all see the same canonical form. Always
import this instead of ``EmailStr``.
"""

from typing import Annotated

from pydantic import AfterValidator, EmailStr


def _lowercase(value: str) -> str:
    return value.lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_lowercase)]
