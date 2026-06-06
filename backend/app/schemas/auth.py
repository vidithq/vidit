from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import NormalizedEmail


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    email: NormalizedEmail
    password: str = Field(min_length=8, max_length=200)
    invite_code: str = Field(min_length=1, max_length=64)


class RegisterResponse(BaseModel):
    """Response to a successful ``POST /auth/register``.

    The user is NOT signed in — no session cookie is set. The address
    holds a pending row; the user must click the link in the
    confirmation email to actually create the account.
    """

    status: Literal["pending_confirmation"] = "pending_confirmation"
    email: NormalizedEmail


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: str
