import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_default_local_backend_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    settings = Settings()
    assert settings.storage_backend == "local"
    assert settings.s3_bucket == ""


def test_settings_s3_backend_requires_bucket_and_region(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    with pytest.raises(ValidationError, match="S3_BUCKET, AWS_REGION"):
        Settings()


def test_settings_s3_backend_requires_bucket_when_only_region_set(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("AWS_REGION", "eu-west-3")
    with pytest.raises(ValidationError, match="S3_BUCKET"):
        Settings()


def test_settings_full_s3_config_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("AWS_REGION", "eu-west-3")
    monkeypatch.setenv("S3_BUCKET", "vidit-prod")
    settings = Settings()
    assert settings.storage_backend == "s3"


def test_settings_rejects_bucket_without_s3_backend(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("S3_BUCKET", "vidit-prod")
    with pytest.raises(ValidationError, match="S3_BUCKET is set"):
        Settings()


def test_database_url_postgres_scheme_is_normalized(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@h:5432/db")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    settings = Settings()
    assert settings.database_url == "postgresql://u:p@h:5432/db"


def test_database_url_postgresql_scheme_passes_through(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/db")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    settings = Settings()
    assert settings.database_url == "postgresql://u:p@h:5432/db"


def test_default_jwt_secret_with_localhost_db_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    settings = Settings()
    assert settings.jwt_secret == "changeme-in-production"


def test_default_jwt_secret_with_remote_db_fails(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    with pytest.raises(ValidationError, match="JWT_SECRET must be set"):
        Settings()


def test_overridden_jwt_secret_with_remote_db_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "a-real-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    settings = Settings()
    assert settings.jwt_secret == "a-real-secret"


def test_remote_db_with_cookie_secure_false_fails(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "a-real-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    with pytest.raises(ValidationError, match="COOKIE_SECURE must be true"):
        Settings()


def test_remote_db_with_cookie_secure_true_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "a-real-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    settings = Settings()
    assert settings.cookie_secure is True


def test_default_jwt_secret_with_ipv6_localhost_passes(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@[::1]:5432/db")
    settings = Settings()
    assert settings.jwt_secret == "changeme-in-production"


def test_default_jwt_secret_with_unparseable_host_fails(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql:///db")
    with pytest.raises(ValidationError, match="JWT_SECRET must be set"):
        Settings()


def test_cors_origin_regex_dropped_on_remote_db(monkeypatch):
    """The localhost dev regex must not survive to a non-local deployment: a
    live localhost origin regex + allow_credentials would let any localhost page
    make credentialed cross-origin reads against the API."""
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "a-real-secret")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    settings = Settings()
    assert settings.cors_origin_regex == r"^https?://localhost:\d+$"
    assert settings.effective_cors_origin_regex == ""


def test_cors_origin_regex_kept_on_local_db(monkeypatch):
    """Locally the regex stands so one backend serves many frontend ports."""
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    settings = Settings()
    assert settings.effective_cors_origin_regex == r"^https?://localhost:\d+$"


def test_cors_origin_regex_non_localhost_pattern_kept_on_remote_db(monkeypatch):
    """A deliberately-set non-localhost regex (e.g. staging) is always honoured."""
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("JWT_SECRET", "a-real-secret")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.railway.internal:5432/db")
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"^https://.*\.staging\.vidit\.app$")
    settings = Settings()
    assert settings.effective_cors_origin_regex == r"^https://.*\.staging\.vidit\.app$"


def _clear_storage_env(monkeypatch):
    for var in ("STORAGE_BACKEND", "AWS_REGION", "S3_BUCKET", "CLOUDFRONT_DOMAIN"):
        monkeypatch.delenv(var, raising=False)
