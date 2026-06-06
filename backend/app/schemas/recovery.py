from pydantic import BaseModel, Field

from app.schemas import NormalizedEmail

# Tokens are minted with `secrets.token_urlsafe(32)` → 43 ASCII chars.
# Capping at 64 leaves headroom for any future bump in entropy without
# accepting arbitrary-length input that would just feed bigger payloads
# into sha256 without being valid tokens anyway.
_TOKEN_MAX = 64


class ForgotPasswordRequest(BaseModel):
    email: NormalizedEmail


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=_TOKEN_MAX)
    new_password: str = Field(min_length=8, max_length=200)


class ConfirmRegistrationRequest(BaseModel):
    """Body for ``POST /auth/confirm-registration``.

    Consumes the token emailed at register time, creates the ``users``
    row, and issues the session + CSRF cookies. The single request
    therefore both confirms the email and signs the analyst in.
    """

    token: str = Field(min_length=10, max_length=_TOKEN_MAX)


class ResendConfirmationRequest(BaseModel):
    """Body for ``POST /auth/resend-confirmation``.

    Open endpoint (no auth, since the user can't be logged in yet).
    Always 204 — the response cannot leak whether the email matched a
    live pending registration.
    """

    email: NormalizedEmail


class ChangePasswordRequest(BaseModel):
    """Body for ``POST /auth/change-password``.

    Authenticated. The caller proves they hold the current credential
    by submitting ``current_password`` alongside the replacement, so a
    stolen session cookie alone isn't enough to lock the legitimate
    owner out.
    """

    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)
