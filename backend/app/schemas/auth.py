from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import NormalizedEmail

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 200


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    email: NormalizedEmail
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    invite_code: str = Field(min_length=1, max_length=64)


class RegisterResponse(BaseModel):
    """Response to a successful ``POST /auth/register``.

    The user is NOT signed in — no session cookie. The address holds a pending
    row; the account is created only when they click the confirmation link.
    """

    status: Literal["pending_confirmation"] = "pending_confirmation"
    email: NormalizedEmail


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: str
