from typing import Literal
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

DEFAULT_JWT_SECRET = "changeme-in-production"
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
    # 95 MiB, not 100: a max-size video plus multipart overhead must stay
    # under Cloudflare's free-plan 100 MB request cap for the day `api` moves
    # behind the proxy.
    max_video_size: int = 95 * 1024 * 1024
    # Per-event cap on inline proof images (the ``proof_files`` batch a submit
    # carries). Above a legitimate analyst writeup (a dozen annotated frames is
    # rare), tight enough to refuse a pathological payload that would pin the
    # worker through the Pillow + S3 pipeline. The source side needs no knob:
    # an event carries exactly one source media. Lives in config (not the
    # events router) so the body-size middleware reads it at boot without a
    # ``main → routers`` import edge. Per-file caps are the two settings above.
    max_proof_images_per_event: int = 10
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:3002"
    # Extra origin regex OR'd with `cors_origins` by Starlette's CORSMiddleware.
    # Default whitelists every `localhost:<port>` so one backend can serve
    # several concurrent frontends (worktrees, a/b sessions). Safe in prod:
    # auth cookies are domain-scoped to `.vidit.app`, so a localhost:N page in
    # someone's browser can't include them in a request to api.vidit.app even
    # if CORS lets the request through.
    cors_origin_regex: str = r"^https?://localhost:\d+$"
    # Cookie auth: set SameSite=none + Secure when frontend and backend live on
    # different registrable domains (e.g. vercel.app → up.railway.app). Locally
    # (localhost:3000 → localhost:8000) lax + insecure is enough.
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str = ""  # empty → host-only cookie (recommended)
    # Master switch for the shared slowapi limiter (app/ratelimit.py). Limits
    # are per-endpoint decorators (e.g. 5/min on /login, 10/hr on /register,
    # per-minute reads/writes elsewhere) — there is no global floor. Hostile
    # during local dev iteration (repeated register/login); set false in
    # backend/.env to silence every limit at once.
    rate_limit_enabled: bool = True
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.0

    # Trusted proxy hops in front of the backend. Each appends its observed
    # connecting IP to ``X-Forwarded-For``, so the rate-limit key
    # (``services.audit.rate_limit_key``) picks the entry at position
    # ``-trusted_proxy_hops`` (1 = right-most = Railway only, current prod
    # topology; bump to 2 if Cloudflare or another trusted reverse proxy ever
    # sits in front of Railway).
    trusted_proxy_hops: int = 1

    # Transactional email. `console` (local-dev default) logs instead of
    # sending. `resend` POSTs to https://api.resend.com/emails — requires
    # RESEND_API_KEY and a verified `EMAIL_FROM` domain in the Resend dashboard.
    email_provider: Literal["console", "resend"] = "console"
    resend_api_key: str = ""
    email_from: str = "noreply@vidit.app"
    email_from_name: str = "Vidit"

    # Public frontend origin for links in transactional emails. Fully-qualified
    # URL, no trailing slash. Prod deploy workflow sets this to https://vidit.app.
    frontend_url: str = "http://localhost:3000"

    # Reset token TTL (minutes), short on purpose: the link is single-use, but
    # a tight window also bounds the value of an intercepted email. Registration
    # confirmation TTL is hard-coded in services/registration.py (prod never
    # tunes it).
    password_reset_token_minutes: int = 15

    # Comma-separated allowlist of emails auto-promoted to is_admin on
    # login/register. Survives DB reseeds (avoids a "did you run the script"
    # footgun). Empty (local-dev default) auto-promotes nobody; set to
    # ``admin@vidit.app`` in prod.
    admin_emails: str = ""

    # X bot (the "tag @ViditBot" on-ramp, see docs/ingestion.md). Reading the
    # bot's mentions uses the app-only bearer token + the bot account's numeric
    # user id (stored here so a run never pays a user lookup); both empty means
    # the bot runner refuses to start. Posting replies needs user-context OAuth
    # 1.0a credentials (all four); empty means the run processes mentions but
    # posts nothing.
    x_bot_bearer_token: str = ""
    x_bot_user_id: str = ""
    x_api_consumer_key: str = ""
    x_api_consumer_secret: str = ""
    x_bot_access_token: str = ""
    x_bot_access_token_secret: str = ""
    # Whether the X Account Activity webhook is registered and live in this
    # deployment. Flipped true after ``scripts/manage_x_webhook.py`` register +
    # subscribe succeed against prod. Gates the poll's gap detector: while
    # false, a mention arriving via the cron is nominal and raises no warning.
    x_webhook_enabled: bool = False

    model_config = {"env_file": ".env"}

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalize_postgres_scheme(cls, v: str) -> str:
        # Railway / Heroku inject postgres://; SQLAlchemy 2 requires postgresql://
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
    def _validate_x_bot_config(self) -> "Settings":
        read_pair = (self.x_bot_bearer_token, self.x_bot_user_id)
        if any(read_pair) and not all(read_pair):
            raise ValueError(
                "X_BOT_BEARER_TOKEN and X_BOT_USER_ID must be set together — "
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
                "X_BOT_ACCESS_TOKEN_SECRET) must be set together — refusing a "
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
                "S3_BUCKET is set but STORAGE_BACKEND is not 's3' — refusing to ship a "
                "half-configured storage layer. Set STORAGE_BACKEND=s3 or unset S3_BUCKET."
            )
        return self


settings = Settings()
