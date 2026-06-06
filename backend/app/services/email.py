"""Transactional email — Resend in prod, console echo in dev/test.

We deliberately avoid the official ``resend`` SDK: the API surface we
need is one ``POST /emails`` call with a JSON body, and pulling in a
synchronous third-party HTTP client when ``httpx`` is already in the
deps is more risk than reward. This module is therefore ~40 lines of
real code — easy to audit, easy to mock in tests.

Configuration
-------------

* ``EMAIL_PROVIDER=console`` (default in dev) prints the email to stdout
  and returns. Lets the owner iterate on flows without burning Resend
  quota or chasing DKIM during local dev.
* ``EMAIL_PROVIDER=resend`` POSTs to api.resend.com. Requires
  ``RESEND_API_KEY`` and ``EMAIL_FROM``.

Failure handling
----------------

``send`` raises ``EmailSendError`` on any non-2xx response or transport
error. Callers decide whether the failure is fatal:

* ``/auth/forgot-password``: swallow + log. We respond 204 either way
  to avoid disclosing user existence; an email-send blip mustn't leak it
  via a 500.
* ``/auth/register``: swallow + log. We do NOT want a Resend outage to
  block the pending-registration row insert — the user can hit
  "resend confirmation" later to retry the send.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class EmailSendError(RuntimeError):
    """Raised when the email provider rejected the message or was unreachable."""


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str | None = None


_RESEND_ENDPOINT = "https://api.resend.com/emails"


def _from_address() -> str:
    if settings.email_from_name:
        return f"{settings.email_from_name} <{settings.email_from}>"
    return settings.email_from


def _send_console(email: Email) -> None:
    body = (
        f"\n--- DEV EMAIL ({settings.email_provider}) ---\n"
        f"From: {_from_address()}\n"
        f"To:   {email.to}\n"
        f"Subj: {email.subject}\n\n"
        f"{email.text}\n"
        f"--- end ---\n"
    )
    logger.info(body)


def _send_resend(email: Email) -> None:
    if not settings.resend_api_key:
        raise EmailSendError("RESEND_API_KEY is empty but EMAIL_PROVIDER=resend")

    payload: dict[str, object] = {
        "from": _from_address(),
        "to": [email.to],
        "subject": email.subject,
        "text": email.text,
    }
    if email.html is not None:
        payload["html"] = email.html

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                _RESEND_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            )
    except httpx.HTTPError as exc:
        raise EmailSendError(f"transport error sending to Resend: {exc}") from exc

    if resp.status_code >= 300:
        # Don't log the full body — Resend echoes the recipient address;
        # logging it would defeat the "200 always" anti-enumeration play.
        raise EmailSendError(f"Resend returned {resp.status_code} (see Resend dashboard for body)")


def send(email: Email) -> None:
    provider: Literal["console", "resend"] = settings.email_provider
    if provider == "console":
        _send_console(email)
        return
    if provider == "resend":
        _send_resend(email)
        return
    # pydantic Literal validation should make this unreachable; defensive.
    raise EmailSendError(f"unknown EMAIL_PROVIDER: {provider!r}")


# ── Templates ───────────────────────────────────────────────────────────────
# Kept inline rather than in a templating engine. There are two messages,
# both short, and the strings are easier to review next to the code that
# sends them than separated by an indirection.


def password_reset_email(*, to: str, link: str) -> Email:
    return Email(
        to=to,
        subject="Reset your Vidit password",
        text=(
            "Someone — hopefully you — asked to reset the password on the Vidit\n"
            "account associated with this address.\n"
            "\n"
            f"To set a new password, follow this link within the next 15 minutes:\n"
            f"\n"
            f"  {link}\n"
            "\n"
            "If you didn't request a reset, ignore this email — your password is\n"
            "unchanged. The link only works once.\n"
            "\n"
            "— Vidit\n"
        ),
    )


def password_changed_email(*, to: str) -> Email:
    """Out-of-band heads-up that the password was just rotated.

    The endpoint enforces re-asserting the current password, so a stolen
    cookie alone can't trigger this — but an attacker who has *also*
    obtained the password (phishing, credential stuffing) can. Sending
    a non-actionable notification to the recovery address turns the
    rotation into a detectable event the legitimate owner can react to.

    Intentionally short and informational: no IP, no UA, no
    user-agent-based geo. Adding them would invite confusion when an
    owner rotates from their phone while travelling, and an attacker
    who can read this email has already taken the inbox anyway. The
    forgot-password link is the recovery surface, not a deep link
    inside the change-password flow itself.
    """
    return Email(
        to=to,
        subject="Your Vidit password was changed",
        text=(
            "This is a heads-up that the password on your Vidit account was just\n"
            "changed.\n"
            "\n"
            "If it was you, no action needed.\n"
            "\n"
            "If you didn't change your password, your account may be compromised.\n"
            "Recover the account by resetting the password here:\n"
            "\n"
            "  https://vidit.app/forgot-password\n"
            "\n"
            "— Vidit\n"
        ),
    )


def registration_confirmation_email(*, to: str, link: str) -> Email:
    return Email(
        to=to,
        subject="Confirm your Vidit registration",
        text=(
            "Welcome to Vidit. To finish creating your account, confirm this\n"
            "email address by following the link below within the next 24 hours:\n"
            "\n"
            f"  {link}\n"
            "\n"
            "Until you click the link, no account exists — the registration is\n"
            "held aside, waiting on you. If you don't confirm, it expires and\n"
            "the address is released back to the pool.\n"
            "\n"
            "If you didn't try to register on Vidit, you can ignore this email.\n"
            "\n"
            "— Vidit\n"
        ),
    )
