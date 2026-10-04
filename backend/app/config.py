from typing import Literal
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

DEFAULT_JWT_SECRET = "changeme-in-production"
DEFAULT_CORS_ORIGIN_REGEX = r"^https?://localhost:\d+$"
LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Settings(BaseSettings):
    database_url: str = "postgresql://vision:vision@localhost:5432/vision"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    storage_backend: Literal["s3", "local"] = "local"
    aws_region: str = ""
    s3_bucket: str = ""
    cloudfront_domain: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    local_storage_dir: str = ".local-storage"
    max_image_size: int = 10 * 1024 * 1024  # 10 MB
    # 95 MiB, not 100: a max-size video plus multipart overhead must stay under
    # Cloudflare's free-plan 100 MB request cap.
    max_video_size: int = 95 * 1024 * 1024
    # Per-event cap on inline proof images. Lives here (not the events router)
    # so the body-size middleware reads it without a ``main → routers`` import.
    max_proof_images_per_event: int = 10
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:3002"
    # Extra origin regex OR'd with `cors_origins`. The default allows every
    # `localhost:<port>` for concurrent dev frontends and is dropped on a
    # non-local deployment (see `effective_cors_origin_regex`): with
    # `allow_credentials=True` it would let any localhost page read
    # authenticated responses. An operator-set pattern is always honoured.
    cors_origin_regex: str = DEFAULT_CORS_ORIGIN_REGEX
    # Cookie auth: SameSite=none + Secure when frontend and backend are on
    # different registrable domains; lax + insecure is enough locally.
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str = ""  # empty → host-only cookie (recommended)
    # Master switch for the shared slowapi limiter (app/ratelimit.py). Limits are
    # per-endpoint decorators with no global floor; set false in backend/.env to
    # silence them all during local dev.
    rate_limit_enabled: bool = True
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.0
    # Level of the ``app.*`` loggers (``observability.configure_logging``).
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # Trusted proxy hops in front of the backend. The rate-limit key
    # (``services.audit.rate_limit_key``) picks the ``X-Forwarded-For`` entry at
    # ``-trusted_proxy_hops`` (1 = Railway only; 2 if Cloudflare sits in front).
    trusted_proxy_hops: int = 1

    # Transactional email. `console` logs instead of sending; `resend` needs
    # RESEND_API_KEY and a verified `EMAIL_FROM` domain.
    email_provider: Literal["console", "resend"] = "console"
    resend_api_key: str = ""
    email_from: str = "noreply@vidit.app"
    email_from_name: str = "Vidit"

    # Recipient of the "new content report" notification. Unset sends nothing
    # (reports still queue for the admin console). One address: fan-out is the
    # mail provider's job.
    report_notify_email: str | None = None

    # Public frontend origin for links in emails: absolute URL, no trailing slash.
    frontend_url: str = "http://localhost:3000"

    # Reset token TTL (minutes). Short to bound the value of an intercepted
    # email. The registration confirmation TTL is in services/registration.py.
    password_reset_token_minutes: int = 15

    # Comma-separated emails auto-promoted to is_admin on login/register. Empty
    # promotes nobody.
    admin_emails: str = ""

    # X bot (docs/ingestion.md). Reading mentions needs the bearer token and the
    # bot's numeric user id (stored to skip a lookup per run); both empty means
    # the runner refuses to start. Replies need all four OAuth 1.0a credentials;
    # empty means mentions are processed but nothing is posted.
    x_bot_bearer_token: str = ""
    x_bot_user_id: str = ""
    # The bot's handle, stripped from stored proof text. Configurable so a
    # staging bot or rename cannot leak the tag into proofs.
    x_bot_handle: str = "viditbot"
    x_api_consumer_key: str = ""
    x_api_consumer_secret: str = ""
    x_bot_access_token: str = ""
    x_bot_access_token_secret: str = ""
    # Whether the X Account Activity webhook is live in this deployment. While
    # false, a mention arriving via the cron raises no gap warning.
    x_webhook_enabled: bool = False
    # Billed-spend ceilings on replies. Anyone can tag the bot and each reply is
    # billed, so the window posts at most this many replies (success + failure),
    # in total and per author; past a ceiling the detection still lands but the
    # reply is skipped and logged. The window is the trailing hour read from the
    # ledger, not per pass (the worker drains every few seconds).
    bot_max_replies_per_hour: int = 40
    bot_max_replies_per_author_per_hour: int = 10

    model_config = {"env_file": ".env"}

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_cors_origin_regex(self) -> str:
        """`cors_origin_regex`, minus the shipped localhost default on a
        non-local deployment. With `allow_credentials=True` that default would
        let any localhost page make credentialed reads against the API (writes
        stay blocked by the CSRF token). Only the exact shipped default is
        dropped: an operator-set pattern is always honoured."""
        if self.cors_origin_regex != DEFAULT_CORS_ORIGIN_REGEX:
            return self.cors_origin_regex
        host = urlparse(self.database_url).hostname
        if host is not None and host.lower() in LOCAL_DB_HOSTS:
            return self.cors_origin_regex
        return ""

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, v: object) -> object:
        return v.upper() if isinstance(v, str) else v

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalize_postgres_scheme(cls, v: str) -> str:
        # Railway / Heroku inject postgres://; SQLAlchemy 2 needs postgresql://.
        if v.startswith("postgres://"):
            return "postgresql://" + v.removeprefix("postgres://")
        return v

    @model_validator(mode="after")
    def _validate_jwt_secret(self) -> "Settings":
        if self.jwt_secret != DEFAULT_JWT_SECRET:
            return self
        host = urlparse(self.database_url).hostname
        if host is None or host.lower() not in LOCAL_DB_HOSTS:
            raise ValueError(
                f"JWT_SECRET must be set to a non-default value when DATABASE_URL "
                f"points to a non-local host (got {host!r}). Refusing to start with "
                f"the placeholder secret."
            )
        return self

    @model_validator(mode="after")
    def _validate_cookie_secure(self) -> "Settings":
        if self.cookie_secure:
            return self
        host = urlparse(self.database_url).hostname
        if host is None or host.lower() not in LOCAL_DB_HOSTS:
            raise ValueError(
                f"COOKIE_SECURE must be true when DATABASE_URL points to a "
                f"non-local host (got {host!r}). A non-local deployment must "
                f"set COOKIE_SECURE=true so the session cookie is never sent "
                f"over plaintext."
            )
        return self

    @model_validator(mode="after")
    def _validate_x_bot_config(self) -> "Settings":
        read_pair = (self.x_bot_bearer_token, self.x_bot_user_id)
        if any(read_pair) and not all(read_pair):
            raise ValueError(
                "X_BOT_BEARER_TOKEN and X_BOT_USER_ID must be set together; "
                "refusing a half-configured mentions read."
            )
        write_creds = (
            self.x_api_consumer_key,
            self.x_api_consumer_secret,
            self.x_bot_access_token,
            self.x_bot_access_token_secret,
        )
        if any(write_creds) and not all(write_creds):
            raise ValueError(
                "The four X OAuth 1.0a settings (X_API_CONSUMER_KEY, "
                "X_API_CONSUMER_SECRET, X_BOT_ACCESS_TOKEN, "
                "X_BOT_ACCESS_TOKEN_SECRET) must be set together; refusing a "
                "half-configured reply writer."
            )
        return self

    @model_validator(mode="after")
    def _validate_storage_config(self) -> "Settings":
        if self.storage_backend == "s3":
            missing = [
                name
                for name, value in (("s3_bucket", self.s3_bucket), ("aws_region", self.aws_region))
                if not value
            ]
            if missing:
                raise ValueError(
                    f"STORAGE_BACKEND=s3 requires non-empty {', '.join(missing).upper()}"
                )
        elif self.s3_bucket:
            raise ValueError(
                "S3_BUCKET is set but STORAGE_BACKEND is not 's3'; refusing to ship a "
                "half-configured storage layer. Set STORAGE_BACKEND=s3 or unset S3_BUCKET."
            )
        return self


settings = Settings()
