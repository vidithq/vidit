"""Manage the X Account Activity webhook: register, subscribe, inspect.

Operator tooling for the bot's nominal delivery path (see
``routers/webhooks`` and docs/ingestion.md). One-time setup against prod:

    uv run python scripts/manage_x_webhook.py register https://api.vidit.app/api/v1/webhooks/x
    uv run python scripts/manage_x_webhook.py subscribe <webhook_id>

then flip ``X_WEBHOOK_ENABLED=true`` on the backend services. ``list`` /
``status`` inspect the current state, ``revalidate`` re-runs the CRC after
the endpoint was down through a check, ``delete`` tears the webhook down.

Webhook CRUD runs app-only (bearer token); the subscription binds the bot
account, so ``subscribe`` and ``status`` sign with the OAuth 1.0a user
context. Exits non-zero on any upstream failure, body printed.
"""

import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import httpx

from app.config import settings
from app.services.x_api import _oauth1_header

_API_BASE = "https://api.x.com/2"
_TIMEOUT_S = 30.0


def _require(*pairs: tuple[str, str]) -> None:
    missing = [name for name, value in pairs if not value]
    if missing:
        raise SystemExit(f"missing settings: {', '.join(missing)} (see backend/.env.example)")


def _bearer_request(method: str, url: str, json_body: dict | None = None) -> httpx.Response:
    _require(("X_BOT_BEARER_TOKEN", settings.x_bot_bearer_token))
    return httpx.request(
        method,
        url,
        json=json_body,
        headers={"Authorization": f"Bearer {settings.x_bot_bearer_token}"},
        timeout=_TIMEOUT_S,
    )


def _user_context_request(method: str, url: str) -> httpx.Response:
    _require(
        ("X_API_CONSUMER_KEY", settings.x_api_consumer_key),
        ("X_API_CONSUMER_SECRET", settings.x_api_consumer_secret),
        ("X_BOT_ACCESS_TOKEN", settings.x_bot_access_token),
        ("X_BOT_ACCESS_TOKEN_SECRET", settings.x_bot_access_token_secret),
    )
    header = _oauth1_header(
        method,
        url,
        consumer_key=settings.x_api_consumer_key,
        consumer_secret=settings.x_api_consumer_secret,
        token=settings.x_bot_access_token,
        token_secret=settings.x_bot_access_token_secret,
    )
    return httpx.request(method, url, headers={"Authorization": header}, timeout=_TIMEOUT_S)


def _finish(resp: httpx.Response) -> None:
    body = resp.text.strip() or "(empty body)"
    print(f"{resp.status_code} {body}")
    if resp.status_code >= 300:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("register").add_argument("url", help="public webhook URL (must answer the CRC)")
    sub.add_parser("list")
    sub.add_parser("delete").add_argument("webhook_id")
    sub.add_parser("revalidate").add_argument("webhook_id")
    sub.add_parser("subscribe").add_argument("webhook_id")
    sub.add_parser("status").add_argument("webhook_id")
    args = parser.parse_args()

    if args.command == "register":
        _finish(_bearer_request("POST", f"{_API_BASE}/webhooks", {"url": args.url}))
    elif args.command == "list":
        _finish(_bearer_request("GET", f"{_API_BASE}/webhooks"))
    elif args.command == "delete":
        _finish(_bearer_request("DELETE", f"{_API_BASE}/webhooks/{args.webhook_id}"))
    elif args.command == "revalidate":
        _finish(_bearer_request("PUT", f"{_API_BASE}/webhooks/{args.webhook_id}"))
    elif args.command == "subscribe":
        _finish(
            _user_context_request(
                "POST",
                f"{_API_BASE}/account_activity/webhooks/{args.webhook_id}/subscriptions/all",
            )
        )
    elif args.command == "status":
        _finish(
            _user_context_request(
                "GET",
                f"{_API_BASE}/account_activity/webhooks/{args.webhook_id}/subscriptions/all",
            )
        )


if __name__ == "__main__":
    main()
