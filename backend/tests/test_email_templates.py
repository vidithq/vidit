"""The branded email layout: every builder returns an HTML and a plain-text part
with the same absolute links, and the providers carry both parts."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from html.parser import HTMLParser

import httpx
import pytest

from app.config import settings
from app.services import email

BASE = "https://vidit.example"


@pytest.fixture(autouse=True)
def _frontend_url(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", BASE)


BUILDERS: dict[str, Callable[[], email.Email]] = {
    "password_reset": lambda: email.password_reset_email(
        to="a@example.com", link=f"{BASE}/reset-password?token=tok"
    ),
    "password_changed": lambda: email.password_changed_email(to="a@example.com"),
    "registration_confirmation": lambda: email.registration_confirmation_email(
        to="a@example.com", link=f"{BASE}/confirm-registration?token=tok"
    ),
    "archive_import_complete": lambda: email.archive_import_complete_email(
        to="a@example.com",
        created=3,
        updated=1,
        skipped=2,
        failed=1,
        warnings={},
        detections_link=email.detections_link("bo"),
    ),
    "archive_import_failed": lambda: email.archive_import_failed_email(to="a@example.com"),
    "completion_digest": lambda: email.completion_digest_email(
        to="a@example.com", count=2, link=email.detections_link("bo")
    ),
    "content_report": lambda: email.content_report_email(
        to="mod@example.com",
        target="event",
        target_id="e1",
        target_title="Strike <b>on</b> the depot",
        target_link=email.event_link("e1"),
        reason="privacy",
        details="Line one\nline two",
        reporter="anonymous",
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
    ),
    "request_fulfilled": lambda: email.request_fulfilled_email(
        to="a@example.com", actor="bo", event_id="e1", event_title="Strike & smoke"
    ),
    "new_follower": lambda: email.new_follower_email(to="a@example.com", actor="bo"),
    "x_handle_request_approved": lambda: email.x_handle_request_approved_email(to="a@example.com"),
    "x_handle_request_declined": lambda: email.x_handle_request_declined_email(to="a@example.com"),
    "product_update": lambda: email.product_update_email(
        to="a@example.com",
        label="1.0.0",
        title="Collections",
        blocks=["A release.", ("One", "Two")],
        link_url=f"{BASE}/about",
        unsubscribe_url=f"{BASE}/unsubscribe?token=tok",
        one_click_url="https://api.example.com/api/v1/product-updates/unsubscribe?token=tok",
    ),
}


class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []
        self.srcs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.hrefs.append(values["href"] or "")
        if tag == "img" and values.get("src"):
            self.srcs.append(values["src"] or "")


def _links(html: str) -> _Links:
    parser = _Links()
    parser.feed(html)
    return parser


@pytest.mark.parametrize("name", sorted(BUILDERS))
def test_every_builder_returns_both_parts_with_absolute_links(name):
    message = BUILDERS[name]()
    assert message.text.strip()
    assert message.html.startswith("<!doctype html>")

    links = _links(message.html)
    assert links.hrefs, "the footer links at least"
    for url in links.hrefs + links.srcs:
        assert url.startswith(f"{BASE}/"), url
    for url in re.findall(r"https?://\S+", message.text):
        assert url.startswith(f"{BASE}/"), url

    # Every HTML link is in the text part too, and the footer is in both.
    for url in links.hrefs:
        assert url.replace("&amp;", "&") in message.text
    assert f"{BASE}/settings" in links.hrefs
    assert f"{BASE}/legal" in links.hrefs
    assert links.srcs == [f"{BASE}/icon/android-192"]


def test_user_text_is_escaped_in_html_and_verbatim_in_text():
    message = BUILDERS["content_report"]()
    assert "Strike &lt;b&gt;on&lt;/b&gt; the depot" in message.html
    assert "<b>on</b>" not in message.html
    assert "Strike <b>on</b> the depot" in message.text
    # A line break in the reporter's details survives in both parts.
    assert "Line one<br>line two" in message.html
    assert "Line one\nline two" in message.text


_PHISH = "https://vidit-login.example/reset"


@pytest.mark.parametrize(
    "message",
    [
        pytest.param(
            lambda: email.co_geolocator_invite_email(
                to="a@example.com", actor="bo", event_id="e1", event_title=f"Log in at {_PHISH}"
            ),
            id="event title",
        ),
        pytest.param(
            lambda: email.content_report_email(
                to="mod@example.com",
                target="event",
                target_id="e1",
                target_title=_PHISH,
                target_link=email.event_link("e1"),
                reason="spam",
                details=f"See {_PHISH}",
                reporter="anonymous",
                created_at=datetime(2026, 10, 1, tzinfo=UTC),
            ),
            id="report details",
        ),
    ],
)
def test_a_url_in_user_text_is_never_a_link(message):
    built = message()
    assert not [href for href in _links(built.html).hrefs if "vidit-login" in href]
    assert _PHISH in built.html
    assert f"{BASE}/events/e1" in _links(built.html).hrefs


def test_product_update_blocks_link_the_admins_urls():
    built = email.product_update_email(
        to="a@example.com",
        label="1.0.0",
        title="Collections",
        blocks=[f"Read the guide at {BASE}/guide."],
        link_url=None,
        unsubscribe_url=f"{BASE}/unsubscribe?token=tok",
        one_click_url="https://api.example.com/api/v1/product-updates/unsubscribe?token=tok",
    )
    assert f"{BASE}/guide." in _links(built.html).hrefs


def test_password_changed_links_to_the_configured_frontend():
    message = email.password_changed_email(to="a@example.com")
    assert f"{BASE}/forgot-password" in message.text
    assert "https://vidit.app" not in message.text


_ONE_CLICK = "https://api.example.com/api/v1/notifications/unsubscribe?token=tok"


@pytest.mark.parametrize("name", ["request_fulfilled", "new_follower"])
def test_notification_email_names_the_switch_and_takes_a_one_click_unsubscribe(name):
    message = email.one_click_unsubscribe(BUILDERS[name](), _ONE_CLICK)
    assert message.headers == {
        "List-Unsubscribe": f"<{_ONE_CLICK}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    assert "notification settings" in message.text
    # The kind's label in Settings, whatever layout shows the channel.
    label = {"request_fulfilled": "Request fulfilled", "new_follower": "New follower"}[name]
    assert f"email is on for “{label}”" in message.text
    assert "bo" in message.subject


def test_product_update_email_offers_a_visible_and_a_one_click_unsubscribe():
    message = BUILDERS["product_update"]()
    assert message.subject == "Vidit 1.0.0: Collections"
    assert f"Unsubscribe: {BASE}/unsubscribe?token=tok" in message.text
    assert f'href="{BASE}/unsubscribe?token=tok"' in message.html
    assert message.headers == {
        "List-Unsubscribe": "<https://api.example.com/api/v1/product-updates/unsubscribe?token=tok>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


def test_auth_email_carries_no_list_unsubscribe():
    assert BUILDERS["password_reset"]().headers == {}


def test_console_provider_prints_both_parts(monkeypatch, capsys):
    monkeypatch.setattr(settings, "email_provider", "console")
    email.send(email.one_click_unsubscribe(BUILDERS["request_fulfilled"](), _ONE_CLICK))
    out = capsys.readouterr().out
    assert "View the geolocation:" in out
    assert "List-Unsubscribe:" in out
    assert "=== HTML part ===" in out
    assert "<!doctype html>" in out


_REAL_CLIENT = httpx.Client


def _resend(monkeypatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    monkeypatch.setattr(settings, "email_provider", "resend")
    monkeypatch.setattr(settings, "resend_api_key", "re_test")
    monkeypatch.setattr(
        email.httpx,
        "Client",
        lambda **kw: _REAL_CLIENT(transport=httpx.MockTransport(handler), **kw),
    )


def test_resend_payload_carries_html_and_headers(monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "x"})

    _resend(monkeypatch, handler)
    message = email.one_click_unsubscribe(BUILDERS["new_follower"](), _ONE_CLICK)
    email.send(message)

    payload = json.loads(seen[0].content)
    assert payload["html"] == message.html
    assert payload["text"] == message.text
    assert payload["headers"] == dict(message.headers)


def test_resend_refusal_is_a_rejection_and_transport_error_is_not(monkeypatch):
    _resend(monkeypatch, lambda _req: httpx.Response(422))
    with pytest.raises(email.EmailRejectedError):
        email.send(BUILDERS["password_reset"]())

    def boom(_req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    _resend(monkeypatch, boom)
    with pytest.raises(email.EmailSendError) as caught:
        email.send(BUILDERS["password_reset"]())
    assert not isinstance(caught.value, email.EmailRejectedError)
