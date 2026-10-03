"""Error tracking boot, shared by the API and the scheduler scripts."""

import sentry_sdk

from app.config import settings


def init_sentry() -> None:
    """Start Sentry when ``SENTRY_DSN`` is set; do nothing otherwise.

    Events leave out frame local variables and request bodies. Either can hold
    a password or an API credential, and the SDK's denylist matches exact key
    names only (``password``, not ``new_password``).
    """
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
    )
