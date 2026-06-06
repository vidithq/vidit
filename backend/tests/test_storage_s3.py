import io
from unittest.mock import MagicMock

import boto3
import pytest
from fastapi import UploadFile
from moto import mock_aws

from app.services.storage import S3Storage, StorageDeleteError

REGION = "eu-west-3"
BUCKET = "vidit-test-bucket"


def _upload_file(name: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        filename=name, file=io.BytesIO(content), headers={"content-type": content_type}
    )


@pytest.fixture
def s3_setup():
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": REGION},
        )
        yield client


async def test_s3_storage_upload_puts_object_and_returns_s3_url(s3_setup):
    import hashlib

    backend = S3Storage(bucket=BUCKET, region=REGION)
    file = _upload_file("evidence.jpg", b"image-bytes", "image/jpeg")

    result = await backend.upload(file, "uploads/abc/evidence.jpg")

    assert result.url == f"https://{BUCKET}.s3.{REGION}.amazonaws.com/uploads/abc/evidence.jpg"
    body = s3_setup.get_object(Bucket=BUCKET, Key="uploads/abc/evidence.jpg")["Body"].read()
    assert body == b"image-bytes"
    # Hash matches independently-computed sha256 of what landed on S3.
    assert result.sha256 == hashlib.sha256(b"image-bytes").hexdigest()


async def test_s3_storage_upload_bytes_puts_object_with_content_type(s3_setup):
    import hashlib

    backend = S3Storage(bucket=BUCKET, region=REGION)

    result = await backend.upload_bytes(b"raw", "seed/demo/x.png", "image/png")

    head = s3_setup.head_object(Bucket=BUCKET, Key="seed/demo/x.png")
    assert head["ContentType"] == "image/png"
    body = s3_setup.get_object(Bucket=BUCKET, Key="seed/demo/x.png")["Body"].read()
    assert body == b"raw"
    assert result.url == f"https://{BUCKET}.s3.{REGION}.amazonaws.com/seed/demo/x.png"
    assert result.sha256 == hashlib.sha256(b"raw").hexdigest()


def test_s3_storage_public_url_uses_cloudfront_when_set(s3_setup):
    backend = S3Storage(
        bucket=BUCKET,
        region=REGION,
        cloudfront_domain="d123abc.cloudfront.net",
    )

    assert backend.public_url("uploads/x/y.jpg") == "https://d123abc.cloudfront.net/uploads/x/y.jpg"


def test_s3_storage_public_url_falls_back_to_s3_domain(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION)

    assert (
        backend.public_url("uploads/x/y.jpg")
        == f"https://{BUCKET}.s3.{REGION}.amazonaws.com/uploads/x/y.jpg"
    )


@pytest.mark.parametrize(
    "bucket,region",
    [("", REGION), (BUCKET, ""), ("", "")],
)
def test_s3_storage_rejects_empty_bucket_or_region(bucket, region):
    with mock_aws(), pytest.raises(RuntimeError, match="non-empty bucket and region"):
        S3Storage(bucket=bucket, region=region)


def test_s3_storage_key_from_url_inverts_public_url_with_cloudfront(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION, cloudfront_domain="cdn.example.com")
    key = "proof/u/abc.jpg"
    assert backend.key_from_url(backend.public_url(key)) == key


def test_s3_storage_key_from_url_inverts_public_url_without_cloudfront(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION)
    key = "proof/u/abc.jpg"
    assert backend.key_from_url(backend.public_url(key)) == key


def test_s3_storage_key_from_url_accepts_either_prefix_when_cloudfront_set(s3_setup):
    """Old proofs may contain S3-direct URLs from before the CDN was added —
    accept both so historical content stays linkable to its row."""
    backend = S3Storage(bucket=BUCKET, region=REGION, cloudfront_domain="cdn.example.com")
    s3_url = f"https://{BUCKET}.s3.{REGION}.amazonaws.com/proof/u/abc.jpg"
    assert backend.key_from_url(s3_url) == "proof/u/abc.jpg"


def test_s3_storage_key_from_url_rejects_unknown_host(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION)
    assert backend.key_from_url("https://attacker.com/proof/u/abc.jpg") is None


async def test_s3_storage_delete_many_removes_objects(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION)
    await backend.upload_bytes(b"a", "proof/u/a.jpg", "image/jpeg")
    await backend.upload_bytes(b"b", "proof/u/b.jpg", "image/jpeg")

    backend.delete_many(["proof/u/a.jpg", "proof/u/b.jpg"])

    listing = s3_setup.list_objects_v2(Bucket=BUCKET).get("Contents", [])
    assert listing == []


def test_s3_storage_delete_many_handles_empty(s3_setup):
    backend = S3Storage(bucket=BUCKET, region=REGION)
    backend.delete_many([])  # must not raise on empty input


def test_s3_storage_delete_many_raises_on_per_key_failure():
    """boto3.delete_objects does NOT raise on per-key failures; it
    reports them in response['Errors']. The wrapper must escalate that
    to a StorageDeleteError so callers don't silently leave orphans."""
    backend = S3Storage(bucket=BUCKET, region=REGION)
    backend.client = MagicMock()
    backend.client.delete_objects.return_value = {
        "Deleted": [{"Key": "ok.jpg"}],
        "Errors": [
            {"Key": "bad.jpg", "Code": "AccessDenied", "Message": "denied"},
        ],
    }

    with pytest.raises(StorageDeleteError) as exc_info:
        backend.delete_many(["ok.jpg", "bad.jpg"])

    assert exc_info.value.errors == {"bad.jpg": "AccessDenied: denied"}


def test_s3_storage_delete_many_silent_on_clean_response(s3_setup):
    """When all chunks come back with no Errors[], the call is silent."""
    backend = S3Storage(bucket=BUCKET, region=REGION)
    backend.client = MagicMock()
    backend.client.delete_objects.return_value = {
        "Deleted": [{"Key": "a.jpg"}, {"Key": "b.jpg"}],
        "Errors": [],
    }
    backend.delete_many(["a.jpg", "b.jpg"])  # must not raise
