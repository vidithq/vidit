from pydantic import BaseModel, Field

from app.schemas import NormalizedEmail
from app.schemas.auth import NewPassword

# `secrets.token_urlsafe(32)` is 43 ASCII chars; 64 leaves headroom without
# accepting arbitrary-length input.
_TOKEN_MAX = 64


class ForgotPasswordRequest(BaseModel):
    email: NormalizedEmail


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=_TOKEN_MAX)
    new_password: NewPassword


class ConfirmRegistrationRequest(BaseModel):
    """Body for ``POST /auth/confirm-registration``: consumes the emailed token,
    creates the ``users`` row and issues the session + CSRF cookies."""

    token: str = Field(min_length=10, max_length=_TOKEN_MAX)


class ResendConfirmationRequest(BaseModel):
    """Body for ``POST /auth/resend-confirmation``. Always 204, so it can't leak
    whether the email matched a pending registration."""

    email: NormalizedEmail


class ChangePasswordRequest(BaseModel):
    """Body for ``POST /auth/change-password``. ``current_password`` proves the
    caller holds the credential, so a stolen cookie can't lock the owner out."""

    current_password: str = Field(min_length=1)
    new_password: NewPassword
