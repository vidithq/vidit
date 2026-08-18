"""Transactional email — Resend in prod, console echo in dev/test.

Avoids the official ``resend`` SDK: we need one ``POST /emails`` JSON call,
and pulling in a third-party HTTP client when ``httpx`` is already a dep is
more risk than reward.

Configuration
-------------

* ``EMAIL_PROVIDER=console`` (dev default) prints the email to stdout and
  returns — iterate on flows without burning Resend quota or chasing DKIM.
* ``EMAIL_PROVIDER=resend`` POSTs to api.resend.com. Requires
  ``RESEND_API_KEY`` and ``EMAIL_FROM``.

Failure handling
----------------

``send`` raises ``EmailSendError`` on any non-2xx or transport error.
Callers decide whether it's fatal:

* ``/auth/forgot-password``: swallow + log. Responds 204 either way to
  avoid disclosing user existence; a send blip mustn't leak it via a 500.
* ``/auth/register``: swallow + log. A Resend outage mustn't block the
  pending-registration insert — the user can "resend confirmation" later.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import httpx

from app.config import settings
from app.services.tweet_ingest import WARNING_MESSAGES

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
    # print, not logger.info: uvicorn leaves the root logger unconfigured, so
    # application INFO records are dropped and the promised stdout echo never
    # appears. A plain print is the contract this provider documents.
    print(body, flush=True)


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
        # logging it would defeat the anti-enumeration play.
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
# Inline rather than a templating engine: two short messages, easier to
# review next to the code that sends them than behind an indirection.


def password_reset_email(*, to: str, link: str) -> Email:
    ttl = settings.password_reset_token_minutes
    return Email(
        to=to,
        subject="Reset your Vidit password",
        text=(
            "Someone (hopefully you) asked to reset the password on the Vidit\n"
            "account associated with this address.\n"
            "\n"
            f"To set a new password, follow this link within the next {ttl} minutes:\n"
            "\n"
            f"  {link}\n"
            "\n"
            "If you didn't request a reset, ignore this email: your password is\n"
            "unchanged. The link only works once.\n"
            "\n"
            "— Vidit\n"
        ),
    )


def password_changed_email(*, to: str) -> Email:
    """Out-of-band heads-up that the password was just rotated.

    The endpoint re-asserts the current password, so a stolen cookie alone
    can't trigger this — but an attacker who *also* has the password
    (phishing, credential stuffing) can. A non-actionable notice to the
    recovery address makes the rotation a detectable event.

    No IP / UA / geo: they'd confuse an owner rotating while travelling, and
    an attacker who can read this email has already taken the inbox. The
    forgot-password link is the recovery surface, not a deep link into the
    change-password flow.
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


def detections_link(username: str) -> str:
    """The absolute URL of an analyst's own Detections queue.

    One home for the address every draft-related message points at: the import
    completion mail and the completion digest both send an analyst to the same
    page.
    """
    return f"{settings.frontend_url.rstrip('/')}/profile/{username}/detections"


def archive_import_complete_email(
    *,
    to: str,
    created: int,
    updated: int,
    skipped: int,
    failed: int,
    warnings: dict[str, int] | None = None,
    detections_link: str,
) -> Email:
    # The four counts are disjoint: every detection in the archive lands in
    # exactly one of them, so they read as a breakdown rather than as overlapping
    # callouts. Only the headline is unconditional.
    lines = [f"  {created} new detection{'s' if created != 1 else ''} created"]
    if updated:
        lines.append(f"  {updated} existing draft{'s' if updated != 1 else ''} updated")
    if skipped:
        lines.append(f"  {skipped} left as {'they are' if skipped != 1 else 'it is'} (skipped)")
    if failed:
        lines.append(f"  {failed} could not be imported")
    # The warnings say what review has to answer on the drafts this import
    # created or updated, so they cut across two of the four buckets and sit
    # under their own heading rather than beside disjoint counts.
    raised = warnings or {}
    # One line per warning the import raised, in the shared table's order and
    # in its words: the bot's reply and the import panel say the same sentence
    # for the same code (``tweet_ingest.WARNING_MESSAGES``). What the email adds
    # is the count, of drafts rather than of posts.
    flagged = [
        f"  {raised[code]} draft{'s' if raised[code] != 1 else ''}: {message}"
        for code, message in WARNING_MESSAGES.items()
        if raised.get(code)
    ]
    review = ("\nWhat to look at first:\n\n" + "\n".join(flagged) + "\n") if flagged else ""
    counts = "\n".join(lines)
    return Email(
        to=to,
        subject="Your X archive import is done",
        text=(
            "Your X archive finished importing:\n"
            "\n"
            f"{counts}\n"
            f"{review}"
            "\n"
            "Each detection is a draft attributed to you; review them and\n"
            "geolocate the ones you vouch for:\n"
            "\n"
            f"  {detections_link}\n"
            "\n"
            "— Vidit\n"
        ),
    )


def archive_import_failed_email(*, to: str) -> Email:
    return Email(
        to=to,
        subject="Your X archive import failed",
        text=(
            "Something went wrong while importing your X archive and the\n"
            "import stopped. Anything imported before the failure is kept, and\n"
            "re-uploading the same archive skips it and continues from there.\n"
            "If it keeps failing, reach out on the Discord linked from the\n"
            "site footer.\n"
            "\n"
            "— Vidit\n"
        ),
    )


def completion_digest_email(*, to: str, count: int, link: str) -> Email:
    """The nudge on drafts still awaiting completion.

    One message per analyst, a count and the way back to their queue. It stays
    this thin on purpose: which drafts are worth publishing is a judgment made
    in the queue, so listing titles here would only be a second, staler copy of
    the page the link opens.
    """
    plural = "s" if count != 1 else ""
    return Email(
        to=to,
        subject=f"{count} Vidit draft{plural} awaiting completion",
        text=(
            f"You have {count} imported draft{plural} that hasn't been published\n"
            "yet. Each one is waiting on the two calls only you can make: which\n"
            "conflict it belongs to, and what the footage was shot with.\n"
            "\n"
            "The queue publishes a page at a time: pick the conflict once for\n"
            "the selection, set the capture source per row, publish.\n"
            "\n"
            f"  {link}\n"
            "\n"
            "— Vidit\n"
        ),
    )


def admin_reports_link() -> str:
    """The absolute URL of the admin console, where the report queue lives."""
    return f"{settings.frontend_url.rstrip('/')}/admin"


def event_link(event_id: str) -> str:
    """The absolute URL of one event's page.

    Every event answers here whatever its status: the page serves a
    ``requested`` row by id too and simply omits the location module when the
    row carries no point.
    """
    return f"{settings.frontend_url.rstrip('/')}/events/{event_id}"


def content_report_email(
    *,
    to: str,
    event_id: str,
    event_title: str,
    reason: str,
    details: str | None,
    reporter: str,
    created_at: datetime,
) -> Email:
    """Tell the moderation address that a report just landed.

    Carries the whole report rather than a bare link, so the operator can
    judge from the message whether it needs opening now. ``reporter`` is a
    username or the word ``anonymous``: reporting needs no account, and which
    of the two it was changes how much weight the report carries.
    """
    detail_block = f"Details:\n\n{details}\n\n" if details else ""
    return Email(
        to=to,
        subject=f"Vidit content report: {reason}",
        text=(
            "A viewer reported an event on Vidit.\n"
            "\n"
            f"Event:    {event_title}\n"
            f"Event id: {event_id}\n"
            f"Reason:   {reason}\n"
            f"Reporter: {reporter}\n"
            f"Filed:    {created_at.isoformat()}\n"
            "\n"
            f"{detail_block}"
            "Resolve it from the admin console:\n"
            "\n"
            f"  {admin_reports_link()}\n"
            "\n"
            "The reported event:\n"
            "\n"
            f"  {event_link(event_id)}\n"
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
            "Until you click the link, no account exists; the registration is\n"
            "held aside, waiting on you. If you don't confirm, it expires and\n"
            "the address is released back to the pool.\n"
            "\n"
            "If you didn't try to register on Vidit, you can ignore this email.\n"
            "\n"
            "— Vidit\n"
        ),
    )
