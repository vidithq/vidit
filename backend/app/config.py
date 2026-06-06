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
    max_video_size: int = 100 * 1024 * 1024  # 100 MB
    # Cap per-submission file count. Sized comfortably above any realistic
    # OSINT submission (one source video + a handful of corroborating
    # frames) and tight enough to refuse pathological multi-thousand-file
    # payloads that would otherwise pin the worker through the Pillow +
    # derivative + S3 pipeline in ``routers/geolocations.create_geolocation``.
    # Per-file size caps live on the two settings above. Lives in config
    # rather than the geolocations router so the body-size middleware can
    # read it at app boot without forming a ``main → routers`` import edge.
    max_files_per_geolocation: int = 12
    # Per-user ceiling on inline-proof image uploads in any rolling 24h
    # window. Sized for legitimate analyst workflows (a long writeup with
    # a dozen annotated frames) while putting a hard cap on a single
    # account being weaponised to fill the bucket. The /proof-images
    # endpoint also carries an IP-level rate limit (slowapi) — this is
    # the per-identity backstop.
    max_proof_images_per_user_per_day: int = 200
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:3002"
    # Extra origin regex OR'd with `cors_origins` by Starlette's CORSMiddleware.
    # Default whitelists every `localhost:<port>` so a single backend can serve
    # several concurrent frontends (worktrees, a/b sessions) without bouncing.
    # Safe in prod: auth cookies are domain-scoped to `.vidit.app`, so a page
    # at http://localhost:N in someone's browser can't include them in a
    # request to api.vidit.app even if CORS lets the request through.
    cors_origin_regex: str = r"^https?://localhost:\d+$"
    # Cookie auth: set SameSite=none + Secure when frontend and backend live on
    # different registrable domains (e.g. vercel.app → up.railway.app). Locally
    # (localhost:3000 → localhost:8000) lax + insecure is enough.
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str = ""  # empty → host-only cookie (recommended)
    # Front-door rate limits (60/min default, 5/min on /login, 10/hr on
    # /register). Useful in prod, hostile during local dev iteration when the
    # owner is repeatedly registering and signing in. Set to false in
    # backend/.env to silence the limiter locally.
    rate_limit_enabled: bool = True
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.0

    # Number of trusted proxy hops in front of the backend. Each trusted
    # proxy appends its observation of the connecting IP to
    # ``X-Forwarded-For``, so ``extract_client_ip`` picks the entry at
    # position ``-trusted_proxy_hops`` (1 = right-most = Railway only,
    # the current prod topology; bump to 2 if Cloudflare or another
    # trusted reverse proxy ever sits in front of Railway).
    trusted_proxy_hops: int = 1

    # ── Transactional email ─────────────────────────────────────────────────
    # `console` (default for local dev) logs the message instead of sending.
    # `resend` POSTs to https://api.resend.com/emails — requires
    # RESEND_API_KEY and a verified `EMAIL_FROM` domain in the Resend dashboard.
    email_provider: Literal["console", "resend"] = "console"
    resend_api_key: str = ""
    email_from: str = "noreply@vidit.app"
    email_from_name: str = "Vidit"

    # Public origin of the frontend, used to build links in transactional
    # emails. Must be a fully-qualified URL with no trailing slash. Locally
    # we default to the Next dev server; in prod the deploy workflow sets
    # this to https://vidit.app.
    frontend_url: str = "http://localhost:3000"

    # Token TTL (minutes). Reset is short on purpose — the link works
    # once, but a tight window also bounds the value of an intercepted
    # email. The registration confirmation TTL is hard-coded in
    # services/registration.py because nothing in production tunes it.
    password_reset_token_minutes: int = 15

    # Comma-separated allowlist of email addresses auto-promoted to is_admin
    # on login/register. Survives DB reseeds and avoids a "did you remember
    # to run the script" footgun. Empty (the default for local dev) means
    # nobody auto-promotes — set to ``admin@vidit.app`` in prod.
    admin_emails: str = ""

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
