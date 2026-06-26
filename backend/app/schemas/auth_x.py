"""Schemas for the X OAuth register-with-X completion.

The OAuth round-trip itself is browser redirects (no JSON bodies); only the
final account-creation step carries a body. The proven handle is authoritative
from the signed ``vidit_x_register`` cookie — never the request body.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class XRegisterRequest(BaseModel):
    """Body for ``POST /auth/x/register`` — the chosen username for the
    X-only account. Mirrors the ``username`` bounds of ``RegisterRequest``."""

    username: str = Field(min_length=1, max_length=50)


class XPendingResponse(BaseModel):
    """The verified handle, for the register-with-X page to display."""

    handle: str
