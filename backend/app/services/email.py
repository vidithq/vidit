"""Transactional email: Resend in prod, console echo in dev/test.

One ``httpx`` call to ``POST /emails``, no ``resend`` SDK.

``EMAIL_PROVIDER=resend`` needs ``RESEND_API_KEY`` and ``EMAIL_FROM``.

Every builder renders through ``email_layout``, so each message carries an
HTML part and a plain-text part with the same content.

``send`` raises ``EmailSendError`` on any non-2xx or transport error, and its
subclass ``EmailRejectedError`` when the provider answered with a refusal, so
the message was certainly not sent. Callers swallow and log:
``/auth/forgot-password`` answers 204 either way (a 500 would disclose user
existence), and ``/auth/register`` must still insert the pending registration
during a Resend outage.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Literal

import httpx

from app.config import settings
from app.services.email_layout import (
    Action,
    Block,
    Content,
    app_url,
    render_html,
    render_text,
    settings_url,
)
from app.services.tweet_ingest import WARNING_MESSAGES

logger = logging.getLogger(__name__)


class EmailSendError(RuntimeError):
    """Raised when the email provider rejected the message or was unreachable."""


class EmailRejectedError(EmailSendError):
    """Raised when the provider answered and refused the message."""


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str
    headers: Mapping[str, str] = field(default_factory=dict)


def _compose(
    *, to: str, subject: str, content: Content, headers: Mapping[str, str] | None = None
) -> Email:
    return Email(
        to=to,
        subject=subject,
        text=render_text(content),
        html=render_html(content, subject=subject),
        headers=dict(headers or {}),
    )


_RESEND_ENDPOINT = "https://api.resend.com/emails"


def _from_address() -> str:
    if settings.email_from_name:
        return f"{settings.email_from_name} <{settings.email_from}>"
    return settings.email_from


def _send_console(email: Email) -> None:
    headers = "".join(f"{name}: {value}\n" for name, value in email.headers.items())
    body = (
        f"\n=== DEV EMAIL ({settings.email_provider}) ===\n"
        f"From: {_from_address()}\n"
        f"To:   {email.to}\n"
        f"Subj: {email.subject}\n"
        f"{headers}\n"
        f"{email.text}\n"
        f"=== HTML part ===\n"
        f"{email.html}"
        f"=== end ===\n"
    )
    # print, not logger.info: LOG_LEVEL cannot drop it, the reset link never
    # becomes a Sentry breadcrumb, and it prints as one block.
    print(body, flush=True)


def _send_resend(email: Email) -> None:
    if not settings.resend_api_key:
        raise EmailRejectedError("RESEND_API_KEY is empty but EMAIL_PROVIDER=resend")

    payload: dict[str, object] = {
        "from": _from_address(),
        "to": [email.to],
        "subject": email.subject,
        "text": email.text,
        "html": email.html,
    }
    if email.headers:
        payload["headers"] = dict(email.headers)

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
        # No body in the message: Resend echoes the recipient address, which
        # would defeat anti-enumeration.
        raise EmailRejectedError(
            f"Resend returned {resp.status_code} (see Resend dashboard for body)"
        )


def send(email: Email) -> None:
    provider: Literal["console", "resend"] = settings.email_provider
    if provider == "console":
        _send_console(email)
        return
    if provider == "resend":
        _send_resend(email)
        return
    raise EmailSendError(f"unknown EMAIL_PROVIDER: {provider!r}")


def password_reset_email(*, to: str, link: str) -> Email:
    ttl = settings.password_reset_token_minutes
    return _compose(
        to=to,
        subject="Reset your Vidit password",
        content=Content(
            heading="Reset your password",
            blocks=[
                "Someone asked to reset the password on the Vidit account that uses this "
                f"address. To set a new password, follow the link within {ttl} minutes.",
            ],
            action=Action("Set a new password", link),
            note="If you did not ask for a reset, ignore this email: your password is "
            "unchanged. The link works once.",
        ),
    )


def password_changed_email(*, to: str) -> Email:
    """Out-of-band notice that the password was rotated, so an attacker who has the password is detectable.

    No IP / UA / geo (they confuse a travelling owner). The forgot-password
    link is the recovery surface, not a deep link into change-password.
    """
    return _compose(
        to=to,
        subject="Your Vidit password was changed",
        content=Content(
            heading="Your password was changed",
            blocks=[
                "The password on your Vidit account was just changed. If it was you, "
                "you have nothing to do.",
                "If you did not change it, your account may be compromised. Recover it by "
                "resetting the password.",
            ],
            action=Action("Reset your password", app_url("/forgot-password")),
        ),
    )


def detections_link(username: str) -> str:
    """The absolute URL of an analyst's own Detections queue."""
    return app_url(f"/profile/{username}/detections")


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'s' if count != 1 else ''}"


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
    # The four counts are disjoint. Only the headline is unconditional.
    counts = [f"{_plural(created, 'new detection')} created"]
    if updated:
        counts.append(f"{_plural(updated, 'existing detection')} updated")
    if skipped:
        counts.append(f"{skipped} left as {'they are' if skipped != 1 else 'it is'} (skipped)")
    if failed:
        counts.append(f"{failed} could not be imported")
    # Warnings cut across two of the four buckets, so they get their own
    # heading. Wording comes from ``tweet_ingest.WARNING_MESSAGES``, shared with
    # the bot reply and the import panel; the email counts detections, not posts.
    raised = warnings or {}
    flagged = tuple(
        f"{_plural(raised[code], 'detection')}: {message}"
        for code, message in WARNING_MESSAGES.items()
        if raised.get(code)
    )
    blocks: list[Block] = ["Your X archive finished importing.", tuple(counts)]
    if flagged:
        blocks += ["What to look at first:", flagged]
    blocks.append(
        "Each detection is attributed to you. Review them and geolocate the ones you vouch for."
    )
    return _compose(
        to=to,
        subject="Your X archive import is done",
        content=Content(
            heading="Your archive import is done",
            blocks=blocks,
            action=Action("Review your detections", detections_link),
        ),
    )


def archive_import_failed_email(*, to: str) -> Email:
    return _compose(
        to=to,
        subject="Your X archive import failed",
        content=Content(
            heading="Your archive import failed",
            blocks=[
                "Something went wrong while importing your X archive and the import stopped. "
                "Anything imported before the failure is kept, and uploading the same archive "
                "again skips it and continues from there.",
            ],
            action=Action("Upload the archive again", app_url("/import")),
            note="If it keeps failing, reach out on the Discord linked from the site footer.",
        ),
    )


def completion_digest_email(*, to: str, count: int, link: str) -> Email:
    """Count of detections awaiting completion plus the queue link.

    Thin on purpose: no titles, since the queue is the source of truth.
    """
    plural = "s" if count != 1 else ""
    return _compose(
        to=to,
        subject=f"{count} Vidit detection{plural} awaiting completion",
        content=Content(
            heading=f"{_plural(count, 'detection')} awaiting completion",
            blocks=[
                f"You have {_plural(count, 'imported detection')} not published yet. Each one "
                "waits on the two calls only you can make: which conflict it belongs to, and "
                "what the footage was shot with.",
                "The queue publishes a page at a time: pick the conflict once for the "
                "selection, set the capture source per row, publish.",
            ],
            action=Action("Open your detections", link),
        ),
    )


def admin_reports_link() -> str:
    """The absolute URL of the admin console report queue."""
    return app_url("/admin")


def event_link(event_id: str) -> str:
    """The absolute URL of one event's page (served for every status)."""
    return app_url(f"/events/{event_id}")


def collection_link(collection_id: str) -> str:
    """The absolute URL of one collection's page (404 for non-admins when withheld)."""
    return app_url(f"/collections/{collection_id}")


def content_report_email(
    *,
    to: str,
    target: str,
    target_id: str,
    target_title: str,
    target_link: str,
    reason: str,
    details: str | None,
    reporter: str,
    created_at: datetime,
) -> Email:
    """Tell the moderation address that a report landed, with the full report inline.

    ``reporter`` is a username or ``anonymous``. ``target`` is ``event`` or
    ``collection`` and names every line that describes the thing.
    """
    label = target.capitalize()
    blocks: list[Block] = [
        f"A viewer reported {'an' if target[0] in 'aeiou' else 'a'} {target} on Vidit.",
        (
            f"{label}: {target_title}",
            f"{label} id: {target_id}",
            f"Reason: {reason}",
            f"Reporter: {reporter}",
            f"Filed: {created_at.isoformat()}",
        ),
    ]
    if details:
        blocks += ["Details:", details]
    return _compose(
        to=to,
        subject=f"Vidit content report: {reason}",
        content=Content(
            heading="New content report",
            blocks=blocks,
            action=Action("Resolve it in the admin console", admin_reports_link()),
            note=f"The reported {target}: {target_link}",
        ),
    )


def registration_confirmation_email(*, to: str, link: str) -> Email:
    return _compose(
        to=to,
        subject="Confirm your Vidit registration",
        content=Content(
            heading="Confirm your email address",
            blocks=[
                "Welcome to Vidit. To finish creating your account, confirm this email "
                "address within the next 24 hours.",
                "Until you follow the link, no account exists: the registration is held "
                "aside. If you do not confirm, it expires and the address is released.",
            ],
            action=Action("Confirm your address", link),
            note="If you did not register on Vidit, ignore this email.",
        ),
    )


def _notification_email(
    *, to: str, subject: str, blocks: list[Block], action: Action, setting: str
) -> Email:
    """A notification: what happened, a link to it, and the switch that sent it. The sender adds
    the one-click unsubscribe of the switch (:func:`one_click_unsubscribe`). ``setting`` is the
    kind's label in Settings, mirrored by the frontend's lib/notifications
    NOTIFICATION_KIND_COPY; change both."""
    return _compose(
        to=to,
        subject=subject,
        content=Content(
            heading=subject,
            blocks=blocks,
            action=action,
            note=f"You get this email because email is on for “{setting}”. Change it in your "
            f"notification settings: {settings_url()}",
        ),
    )


def one_click_unsubscribe(message: Email, url: str) -> Email:
    """``message`` with the RFC 8058 headers: a mail client posts ``url`` to unsubscribe."""
    return replace(
        message,
        headers={
            **message.headers,
            "List-Unsubscribe": f"<{url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )


def request_fulfilled_email(*, to: str, actor: str, event_id: str, event_title: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} geolocated your request",
        blocks=[f"{actor} answered your request “{event_title}” with a geolocation."],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Request fulfilled",
    )


def new_follower_email(*, to: str, actor: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} follows you on Vidit",
        blocks=[f"{actor} now follows your work on Vidit."],
        action=Action("View their profile", app_url(f"/profile/{actor}")),
        setting="New follower",
    )


def x_handle_request_approved_email(*, to: str) -> Email:
    return _notification_email(
        to=to,
        subject="Your X handle change was approved",
        blocks=[
            "An admin linked the X handle you requested to your Vidit account. "
            "The Vidit bot and the archive import now credit posts from that handle to you."
        ],
        action=Action("Open your settings", settings_url()),
        setting="X handle change approved",
    )


def x_handle_request_declined_email(*, to: str) -> Email:
    return _notification_email(
        to=to,
        subject="Your X handle change was declined",
        blocks=[
            "An admin declined the X handle you requested. Your settings show the reason, "
            "and you can send a new request from there."
        ],
        action=Action("Open your settings", settings_url()),
        setting="X handle change declined",
    )


def co_geolocator_invite_email(*, to: str, actor: str, event_id: str, event_title: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} invites you to share a geolocation",
        blocks=[
            f"{actor} invites you to be credited as a geolocator of “{event_title}”. "
            "Accept or decline on the geolocation's page. Editing and closing stay with the owner."
        ],
        action=Action("View the invitation", event_link(event_id)),
        setting="Geolocator invitation",
    )


def co_geolocator_removed_email(*, to: str, actor: str, event_id: str, event_title: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} removed you from a geolocation",
        blocks=[f"{actor} removed you from the geolocators of “{event_title}”."],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Credit removed",
    )


def ownership_transferred_email(*, to: str, event_id: str, event_title: str) -> Email:
    return _notification_email(
        to=to,
        subject="A geolocation you share is now yours",
        blocks=[
            f"You now own “{event_title}”: the account of its previous owner was removed. "
            "You can edit, correct and close it."
        ],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Ownership transferred",
    )


def organization_approval_removed_email(
    *, to: str, organization: str, event_id: str, event_title: str
) -> Email:
    return _notification_email(
        to=to,
        subject=f"{organization} was removed from Vidit",
        blocks=[
            f"{organization} was removed from Vidit, and its approval of “{event_title}” "
            "went with it. The event and its other approvals are unchanged."
        ],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Organization approval removed",
    )


def organization_link(slug: str) -> str:
    """The absolute URL of one organization's page."""
    return app_url(f"/organizations/{slug}")


def organization_invite_email(*, to: str, actor: str, slug: str, name: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} invites you to join {name}",
        blocks=[
            f"{actor}, an org manager of {name}, invites you to join the organization on Vidit. "
            "Accept or decline on its page."
        ],
        action=Action("View the invitation", organization_link(slug)),
        setting="Organization invite",
    )


def organization_invite_accepted_email(*, to: str, actor: str, slug: str, name: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"{actor} joined {name}",
        blocks=[f"{actor} accepted your invitation and is now a member of {name}."],
        action=Action("View the organization", organization_link(slug)),
        setting="Invite accepted",
    )


def organization_manager_inherited_email(*, to: str, slug: str, name: str) -> Email:
    return _notification_email(
        to=to,
        subject=f"You are now an org manager of {name}",
        blocks=[
            f"The account of the last org manager of {name} was removed, and you were its "
            "earliest member, so you are now its org manager. You can invite analysts, "
            "change roles and edit its profile."
        ],
        action=Action("View the organization", organization_link(slug)),
        setting="Now org manager",
    )


def re_approve_requested_email(
    *, to: str, actor: str, event_id: str, event_title: str, organization: str | None = None
) -> Email:
    whose = f"{organization}'s approval" if organization else "Your approval"
    again = f"approve again as {organization}" if organization else "approve again"
    return _notification_email(
        to=to,
        subject=f"{actor} saved a new version of a geolocation {organization or 'you'} approved",
        blocks=[
            f"{actor} saved a new version of “{event_title}”. {whose} covered the version "
            f"before it, so it no longer stands. See what changed and {again}."
        ],
        action=Action("Review the new version", event_link(event_id)),
        setting="New version to approve",
    )


def approval_received_email(
    *, to: str, actor: str, event_id: str, event_title: str, organization: str | None = None
) -> Email:
    on_behalf = f" for {organization}" if organization else ""
    return _notification_email(
        to=to,
        subject=f"{actor} approved your geolocation{on_behalf}",
        blocks=[f"{actor} approved the current version of “{event_title}”{on_behalf}."],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Approval received",
    )


def review_request_received_email(
    *, to: str, actor: str, event_id: str, event_title: str, organization: str | None = None
) -> Email:
    target = organization or "you"
    as_target = f" as {organization}" if organization else ""
    return _notification_email(
        to=to,
        subject=f"{actor} asks {target} to review a geolocation",
        blocks=[
            f"{actor} asks {target} to review “{event_title}”. Approve its current "
            f"version{as_target}, or decline the request, from the geolocation's page."
        ],
        action=Action("Review the geolocation", event_link(event_id)),
        setting="Review request",
    )


def review_request_declined_email(
    *, to: str, actor: str, event_id: str, event_title: str, organization: str | None = None
) -> Email:
    on_behalf = f" for {organization}" if organization else ""
    return _notification_email(
        to=to,
        subject=f"{organization or actor} declined to review your geolocation",
        blocks=[f"{actor} declined{on_behalf} your request to review “{event_title}”."],
        action=Action("View the geolocation", event_link(event_id)),
        setting="Review request declined",
    )


def product_update_email(
    *,
    to: str,
    label: str,
    title: str,
    blocks: Sequence[Block],
    link_url: str | None,
    unsubscribe_url: str,
    one_click_url: str,
) -> Email:
    """A major release announcement. The visible link opens the unsubscribe
    page; the header URL takes the one-click POST of RFC 8058. ``blocks`` are an
    admin's words, so a URL in them is a link."""
    message = _compose(
        to=to,
        subject=f"Vidit {label}: {title}",
        content=Content(
            heading=title,
            blocks=blocks,
            action=Action("See what is new", link_url) if link_url else None,
            note="You get this email because you asked for news about major Vidit releases. "
            f"Unsubscribe: {unsubscribe_url}",
            link_blocks=True,
        ),
    )
    return one_click_unsubscribe(message, one_click_url)
