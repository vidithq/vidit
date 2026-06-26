from pydantic import BaseModel, Field

from app.schemas import NormalizedEmail
from app.schemas.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH

# Tokens are `secrets.token_urlsafe(32)` → 43 ASCII chars. Cap at 64 leaves
# headroom for an entropy bump without accepting arbitrary-length input that
# would just feed bigger payloads into sha256 while never being valid tokens.
_TOKEN_MAX = 64


class ForgotPasswordRequest(BaseModel):
    email: NormalizedEmail


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=_TOKEN_MAX)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class ConfirmRegistrationRequest(BaseModel):
    """Body for ``POST /auth/confirm-registration``.

    Consumes the token emailed at register time, creates the ``users`` row, and
    issues the session + CSRF cookies — one request both confirms the email and
    signs the analyst in.
    """

    token: str = Field(min_length=10, max_length=_TOKEN_MAX)


class ResendConfirmationRequest(BaseModel):
    """Body for ``POST /auth/resend-confirmation``.

    Open endpoint (the user can't be logged in yet). Always 204 — the response
    can't leak whether the email matched a live pending registration.
    """

    email: NormalizedEmail


class ChangePasswordRequest(BaseModel):
    """Body for ``POST /auth/change-password``.

    Authenticated. ``current_password`` proves the caller holds the current
    credential, so a stolen session cookie alone can't lock the owner out.
    """

    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
