"""Shared schema primitives.

``NormalizedEmail`` lowercases every email crossing the API. ``users.email`` is
case-preserving with a case-sensitive UNIQUE, so without it ``admin@vidit.app``
and ``Admin@vidit.app`` would register as two users and ``maybe_promote_admin``
would promote both. Always use it instead of ``EmailStr``.

``Username`` is a new username: :data:`USERNAME_PATTERN` is the charset the
``?author=`` filter reads, so every account stays filterable. ``UsernameRef``
names an existing account in a request body; the lookup decides whether it
exists, so an account whose stored username is outside that charset still
resolves.
"""

import re
from typing import Annotated

from pydantic import AfterValidator, EmailStr, Field
from pydantic_core import PydanticCustomError


def _lowercase(value: str) -> str:
    return value.lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_lowercase)]
UsernameRef = Annotated[str, Field(min_length=1, max_length=50)]

# Also the ``?author=`` query guard: it keeps the ``%`` and ``\`` LIKE vectors out of the SQL
# builders. Generated into the frontend's ``lib/api-constants.ts``.
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"


def _username_charset(value: str) -> str:
    if not re.fullmatch(USERNAME_PATTERN, value):
        raise PydanticCustomError(
            "username_invalid",
            "Username must be 1 to 50 characters: letters A to Z, digits, underscores or hyphens.",
        )
    return value


Username = Annotated[
    str, Field(json_schema_extra={"pattern": USERNAME_PATTERN}), AfterValidator(_username_charset)
]
