import pytest
from pydantic import ValidationError

from app.config import Settings

_REMOTE_DB = "postgresql://u:p@db.railway.internal:5432/db"
_LOCAL_DB = "postgresql://u:p@localhost:5432/db"
_DEV_CORS = r"^https?://localhost:\d+$"
# A deployment: a real secret, secure cookies, a database off the machine.
_DEPLOYED = {"JWT_SECRET": "a-real-secret", "COOKIE_SECURE": "true", "DATABASE_URL": _REMOTE_DB}


def _settings(monkeypatch, env: dict[str, str | None]) -> Settings:
    """``Settings()`` read from ``env`` (``None`` unsets a variable), with no storage variables
    and a public ``API_URL`` unless ``env`` says otherwise."""
    for var in ("STORAGE_BACKEND", "AWS_REGION", "S3_BUCKET", "CLOUDFRONT_DOMAIN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("API_URL", "https://api.vidit.example/api/v1")
    for var, value in env.items():
        if value is None:
            monkeypatch.delenv(var, raising=False)
        else:
            monkeypatch.setenv(var, value)
    return Settings()


@pytest.mark.parametrize(
    ("env", "field", "value"),
    [
        pytest.param({}, "storage_backend", "local", id="local-storage-by-default"),
        pytest.param({}, "s3_bucket", "", id="no-bucket-by-default"),
        pytest.param(
            {"STORAGE_BACKEND": "s3", "AWS_REGION": "us-east-1", "S3_BUCKET": "example-bucket"},
            "storage_backend",
            "s3",
            id="full-s3",
        ),
        pytest.param(
            {**_DEPLOYED, "DATABASE_URL": "postgres://u:p@h:5432/db"},
            "database_url",
            "postgresql://u:p@h:5432/db",
            id="postgres-scheme-normalized",
        ),
        pytest.param(
            {**_DEPLOYED, "DATABASE_URL": "postgresql://u:p@h:5432/db"},
            "database_url",
            "postgresql://u:p@h:5432/db",
            id="postgresql-scheme-kept",
        ),
        pytest.param(
            {"JWT_SECRET": None, "DATABASE_URL": _LOCAL_DB},
            "jwt_secret",
            "changeme-in-production",
            id="default-secret-on-localhost",
        ),
        pytest.param(
            {"JWT_SECRET": None, "DATABASE_URL": "postgresql://u:p@[::1]:5432/db"},
            "jwt_secret",
            "changeme-in-production",
            id="default-secret-on-ipv6-localhost",
        ),
        pytest.param(_DEPLOYED, "jwt_secret", "a-real-secret", id="real-secret-deployed"),
        pytest.param(_DEPLOYED, "cookie_secure", True, id="secure-cookies-deployed"),
        # With allow_credentials, the dev regex would let any localhost page read the API.
        pytest.param(_DEPLOYED, "cors_origin_regex", _DEV_CORS, id="dev-cors-regex-stored"),
        pytest.param(_DEPLOYED, "effective_cors_origin_regex", "", id="dev-cors-regex-dropped"),
        pytest.param(
            {"DATABASE_URL": _LOCAL_DB},
            "effective_cors_origin_regex",
            _DEV_CORS,
            id="dev-cors-local",
        ),
        pytest.param(
            {**_DEPLOYED, "CORS_ORIGIN_REGEX": r"^https://.*\.staging\.vidit\.app$"},
            "effective_cors_origin_regex",
            r"^https://.*\.staging\.vidit\.app$",
            id="custom-cors-deployed",
        ),
        # Only the exact shipped default is dropped.
        pytest.param(
            {**_DEPLOYED, "CORS_ORIGIN_REGEX": r"^https://localhost-preview\.vidit\.app$"},
            "effective_cors_origin_regex",
            r"^https://localhost-preview\.vidit\.app$",
            id="custom-localhost-cors-deployed",
        ),
        pytest.param(
            {"NOTIFICATION_EMAIL_DAILY_CAP": "100", "EMAIL_PROVIDER_DAILY_QUOTA": "3000"},
            "notification_email_daily_cap",
            100,
            id="email-cap-under-quota",
        ),
    ],
)
def test_settings_accept(monkeypatch, env, field, value):
    assert getattr(_settings(monkeypatch, env), field) == value


@pytest.mark.parametrize(
    ("env", "message"),
    [
        pytest.param({"STORAGE_BACKEND": "s3"}, "S3_BUCKET, AWS_REGION", id="s3-without-config"),
        pytest.param(
            {"STORAGE_BACKEND": "s3", "AWS_REGION": "us-east-1"},
            "S3_BUCKET",
            id="s3-without-bucket",
        ),
        pytest.param({"S3_BUCKET": "example-bucket"}, "S3_BUCKET is set", id="bucket-without-s3"),
        pytest.param(
            {"JWT_SECRET": None, "DATABASE_URL": _REMOTE_DB},
            "JWT_SECRET must be set",
            id="default-secret-on-remote-db",
        ),
        pytest.param(
            {"JWT_SECRET": None, "DATABASE_URL": "postgresql:///db"},
            "JWT_SECRET must be set",
            id="default-secret-on-unparseable-host",
        ),
        pytest.param(
            {**_DEPLOYED, "COOKIE_SECURE": None},
            "COOKIE_SECURE must be true",
            id="remote-db-without-secure-cookies",
        ),
        pytest.param(
            {"COOKIE_SECURE": "true", "API_URL": None},
            "API_URL must name the public API",
            id="deployed-localhost-api-url",
        ),
        pytest.param(
            {"NOTIFICATION_EMAIL_DAILY_CAP": "100"},
            "EMAIL_PROVIDER_DAILY_QUOTA",
            id="email-cap-over-quota",
        ),
    ],
)
def test_settings_refuse(monkeypatch, env, message):
    with pytest.raises(ValidationError, match=message):
        _settings(monkeypatch, env)
