"""Give each HTTP request an id: on its response, in its log records, on its Sentry events."""

import re
import uuid

import sentry_sdk
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.observability import request_id

REQUEST_ID_HEADER = "X-Request-ID"
# An incoming id is echoed and logged, so it must be short and hold nothing a
# header or a log line could be split on. It needs a letter or digit so that
# ``-``, the mark of a record outside a request, cannot pose as one.
_SAFE_REQUEST_ID = re.compile(r"(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,64}")


class RequestIdMiddleware:
    """Adopt the caller's ``X-Request-ID`` when it is safe, else mint one."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        rid = incoming if _SAFE_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = rid
            await send(message)

        token = request_id.set(rid)
        sentry_sdk.set_tag("request_id", rid)
        await self.app(scope, receive, send_with_request_id)
        # Reset only when the app returns: after an exception the server logs
        # the traceback in this same context, and that record needs the id.
        request_id.reset(token)
