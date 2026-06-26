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
    settings = Settings()
    assert settings.database_url == "postgresql://u:p@h:5432/db"


def test_database_url_postgresql_scheme_passes_through(monkeypatch):
    _clear_storage_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/db")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
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
    settings = Settings()
    assert settings.jwt_secret == "a-real-secret"


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


def test_x_oauth_disabled_by_default(monkeypatch):
    _clear_storage_env(monkeypatch)
    _clear_x_env(monkeypatch)
    settings = Settings()
    assert settings.x_oauth_enabled is False


def test_x_oauth_half_configured_fails(monkeypatch):
    _clear_storage_env(monkeypatch)
    _clear_x_env(monkeypatch)
    monkeypatch.setenv("X_CLIENT_ID", "id-without-the-rest")
    with pytest.raises(ValidationError, match="half-configured"):
        Settings()


def test_x_oauth_full_config_enables(monkeypatch):
    _clear_storage_env(monkeypatch)
    _clear_x_env(monkeypatch)
    monkeypatch.setenv("X_CLIENT_ID", "id")
    monkeypatch.setenv("X_CLIENT_SECRET", "secret")
    monkeypatch.setenv("X_REDIRECT_URI", "https://api.test/api/v1/auth/x/callback")
    settings = Settings()
    assert settings.x_oauth_enabled is True


def _clear_storage_env(monkeypatch):
    for var in ("STORAGE_BACKEND", "AWS_REGION", "S3_BUCKET", "CLOUDFRONT_DOMAIN"):
        monkeypatch.delenv(var, raising=False)


def _clear_x_env(monkeypatch):
    for var in ("X_CLIENT_ID", "X_CLIENT_SECRET", "X_REDIRECT_URI"):
        monkeypatch.delenv(var, raising=False)
