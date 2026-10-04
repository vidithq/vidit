from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field
from pydantic_core import PydanticCustomError

from app.schemas import NormalizedEmail

# Mirrored by ``frontend/src/lib/auth.ts`` (``PASSWORD_MIN_LENGTH``).
PASSWORD_MIN_LENGTH = 8
# bcrypt reads at most 72 bytes, so the ceiling is in UTF-8 bytes, not characters.
PASSWORD_MAX_BYTES = 72


def _within_bcrypt_limit(password: str) -> str:
    if len(password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise PydanticCustomError(
            "password_too_long",
            "Password must be at most {max_bytes} bytes. An ASCII character takes 1 byte; "
            "every other character takes 2 to 4 (most emoji take 4).",
            {"max_bytes": PASSWORD_MAX_BYTES},
        )
    return password


# A password a new credential is hashed from (register, reset, change). A
# character count never exceeds the byte count, so ``max_length`` only stops
# huge input early; the byte check is the rule.
NewPassword = Annotated[
    str,
    Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_BYTES),
    AfterValidator(_within_bcrypt_limit),
]


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    email: NormalizedEmail
    password: NewPassword
    invite_code: str = Field(min_length=1, max_length=64)


class RegisterResponse(BaseModel):
    """Response to a successful ``POST /auth/register``. No session cookie: the
    account exists only after the confirmation link."""

    status: Literal["pending_confirmation"] = "pending_confirmation"
    email: NormalizedEmail


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: str
