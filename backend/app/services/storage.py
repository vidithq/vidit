import asyncio
import hashlib
import logging
import shutil
import unicodedata
from pathlib import Path, PurePosixPath
from typing import NamedTuple, Protocol
from uuid import UUID, uuid4

import boto3
from botocore.exceptions import ClientError
from fastapi import UploadFile

from app.config import settings

logger = logging.getLogger(__name__)

# 64 KB: one chunk in memory during the hash, whatever the file size.
_HASH_CHUNK_SIZE = 64 * 1024


class UploadResult(NamedTuple):
    """What an ``upload`` / ``upload_bytes`` call hands back.

    ``sha256`` is stored on the ``Media`` row (the S3 ETag is unfit: MD5, not
    stable across copies). ``derivative_keys`` are the sibling hero and
    thumbnail keys (empty for videos); callers add them to their cleanup list
    so a failed commit sweeps them too.
    """

    url: str
    sha256: str  # hex-encoded, always 64 chars
    derivative_keys: tuple[str, ...] = ()


def _hash_uploadfile(file: UploadFile) -> str:
    """Stream-hash an ``UploadFile`` in bounded memory (a full read would pin up to
    ``max_video_size`` per upload), then rewind for the uploader."""
    hasher = hashlib.sha256()
    file.file.seek(0)
    while True:
        chunk = file.file.read(_HASH_CHUNK_SIZE)
        if not chunk:
            break
        hasher.update(chunk)
    file.file.seek(0)
    return hasher.hexdigest()


class StorageDeleteError(RuntimeError):
    """One or more keys could not be deleted.

    Carries per-key errors, since boto3 reports them in the response, not as
    an exception.
    """

    def __init__(self, errors: dict[str, str]) -> None:
        self.errors = errors
        super().__init__(
            f"Failed to delete {len(errors)} object(s): "
            + ", ".join(f"{k!r}: {v}" for k, v in list(errors.items())[:5])
            + ("…" if len(errors) > 5 else "")
        )


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES

# Extension comes from the validated MIME, never ``file.filename`` (attacker
# controlled: a long suffix can pass S3's 1024-byte key limit, an RTL override
# can disguise it, a ``.html`` on a ``video/mp4`` lies about content).
_EXTENSION_FOR_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


def safe_storage_extension(content_type: str | None) -> str:
    """Canonical extension for an allowed MIME type, ``""`` for anything else.

    Shared by every key this module mints and by ``detection.open_request``.
    """
    if content_type is None:
        return ""
    return _EXTENSION_FOR_CONTENT_TYPE.get(content_type, "")


LOCAL_STORAGE_MOUNT_PATH = "/local-storage"
LOCAL_DEV_BASE_URL = "http://localhost:8000"
LOCAL_STORAGE_URL_PREFIX = f"{LOCAL_DEV_BASE_URL}{LOCAL_STORAGE_MOUNT_PATH}"

# Dev/CI stand-in for the S3 POST-policy target (``main.py``, local backend only).
DEV_STAGING_UPLOAD_PATH = "/dev/staging-upload"


class PresignedUpload(NamedTuple):
    """Browser direct upload: POST a multipart form to ``url`` with every
    ``fields`` entry ahead of the file part. Same shape for both backends."""

    url: str
    fields: dict[str, str]


def _media_type_and_max_size(content_type: str | None) -> tuple[str, int]:
    """Resolve an allowed MIME to ``(media_type, max byte size)``.

    Shared by :func:`validate_file` and :func:`validate_bytes`. Raises
    ``ValueError`` on a disallowed type.
    """
    if content_type in ALLOWED_IMAGE_TYPES:
        return "image", settings.max_image_size
    if content_type in ALLOWED_VIDEO_TYPES:
        return "video", settings.max_video_size
    raise ValueError(f"File type {content_type} not allowed")


def validate_file(file: UploadFile) -> str:
    """Validate type + size; return media_type ('image' or 'video')."""
    media_type, max_size = _media_type_and_max_size(file.content_type)
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_size:
        raise ValueError(f"File too large: {size} bytes (max {max_size})")
    return media_type


class Storage(Protocol):
    async def upload(self, file: UploadFile, key: str) -> UploadResult: ...
    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult: ...
    def public_url(self, key: str) -> str: ...
    def key_from_url(self, url: str) -> str | None: ...
    def delete_many(self, keys: list[str]) -> None: ...
    def get_to_path(self, key: str, dest: Path) -> None: ...
    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload: ...
    def head_size(self, key: str) -> int | None: ...


class LocalStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Containment check: an absolute or dot-dot key must not escape the root.
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError(f"Storage key escapes the root: {key!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def upload(self, file: UploadFile, key: str) -> UploadResult:
        # Buffering is fine: size is bounded and we hash the bytes anyway.
        file.file.seek(0)
        data = await file.read()
        sha256 = content_sha256(data)
        self._path(key).write_bytes(data)
        return UploadResult(url=self.public_url(key), sha256=sha256)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult:
        sha256 = content_sha256(data)
        self._path(key).write_bytes(data)
        return UploadResult(url=self.public_url(key), sha256=sha256)

    def public_url(self, key: str) -> str:
        return f"{LOCAL_STORAGE_URL_PREFIX}/{key}"

    def key_from_url(self, url: str) -> str | None:
        prefix = f"{LOCAL_STORAGE_URL_PREFIX}/"
        if url.startswith(prefix):
            return url[len(prefix) :]
        return None

    def delete_many(self, keys: list[str]) -> None:
        for key in keys:
            path = self.root / key
            path.unlink(missing_ok=True)
            # Best-effort: remove parent dirs we just emptied, up to the root.
            parent = path.parent
            while parent != self.root and parent.is_dir():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent

    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload:
        """Dev upload endpoint with S3's POST-policy field shape.

        ``max_bytes`` is unused: the dev endpoint enforces its own guard (a
        form field is client-tamperable).
        """
        del max_bytes
        return PresignedUpload(
            url=f"{LOCAL_DEV_BASE_URL}{DEV_STAGING_UPLOAD_PATH}",
            fields={"key": key, "Content-Type": content_type},
        )

    def head_size(self, key: str) -> int | None:
        try:
            path = self._path(key)
        except ValueError:
            return None
        return path.stat().st_size if path.is_file() else None

    def get_to_path(self, key: str, dest: Path) -> None:
        shutil.copyfile(self._path(key), dest)


class S3Storage:
    def __init__(
        self,
        bucket: str,
        region: str,
        cloudfront_domain: str = "",
        aws_access_key_id: str = "",
        aws_secret_access_key: str = "",
    ) -> None:
        if not bucket or not region:
            raise RuntimeError(
                "S3Storage requires non-empty bucket and region (set S3_BUCKET and AWS_REGION)"
            )
        self.bucket = bucket
        self.region = region
        self.cloudfront_domain = cloudfront_domain
        client_kwargs: dict[str, str] = {"region_name": region}
        if aws_access_key_id and aws_secret_access_key:
            client_kwargs["aws_access_key_id"] = aws_access_key_id
            client_kwargs["aws_secret_access_key"] = aws_secret_access_key
        self.client = boto3.client("s3", **client_kwargs)

    async def upload(self, file: UploadFile, key: str) -> UploadResult:
        # Hash in chunks, then stream via ``upload_fileobj``: buffering a
        # whole video per upload would OOM the single worker.
        sha256 = _hash_uploadfile(file)
        extra_args = {"ContentType": file.content_type} if file.content_type else {}
        # ``upload_fileobj`` is sync; ``to_thread`` keeps the loop free.
        await asyncio.to_thread(
            self.client.upload_fileobj,
            file.file,
            self.bucket,
            key,
            ExtraArgs=extra_args,
        )
        return UploadResult(url=self.public_url(key), sha256=sha256)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult:
        # ``to_thread`` matters: the seeder loops hundreds of rows and a
        # blocking ``put_object`` would starve the loop.
        sha256 = content_sha256(data)
        await asyncio.to_thread(
            self.client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return UploadResult(url=self.public_url(key), sha256=sha256)

    def public_url(self, key: str) -> str:
        if self.cloudfront_domain:
            return f"https://{self.cloudfront_domain}/{key}"
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"

    def key_from_url(self, url: str) -> str | None:
        candidates = []
        if self.cloudfront_domain:
            candidates.append(f"https://{self.cloudfront_domain}/")
        candidates.append(f"https://{self.bucket}.s3.{self.region}.amazonaws.com/")
        for prefix in candidates:
            if url.startswith(prefix):
                return url[len(prefix) :]
        return None

    def delete_many(self, keys: list[str]) -> None:
        # DeleteObjects takes up to 1000 keys and reports per-key failures in
        # ``Errors[]`` without raising; aggregate and raise once.
        if not keys:
            return
        all_errors: dict[str, str] = {}
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            response = self.client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": k} for k in chunk]},
            )
            for err in response.get("Errors", []):
                key = err.get("Key", "<unknown>")
                code = err.get("Code", "Unknown")
                msg = err.get("Message", "")
                all_errors[key] = f"{code}: {msg}".strip(": ")
        if all_errors:
            raise StorageDeleteError(all_errors)

    def get_to_path(self, key: str, dest: Path) -> None:
        """Stream the object to ``dest``; staged zips (4 GB guard) cannot be buffered."""
        self.client.download_file(self.bucket, key, str(dest))

    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload:
        """A POST policy, not a presigned PUT: only POST supports
        ``content-length-range``, so S3 rejects an oversize body itself.
        Conditions pin the key and content type; the 15 minute expiry bounds the grant.
        """
        post = self.client.generate_presigned_post(
            Bucket=self.bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"key": key},
                {"Content-Type": content_type},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=15 * 60,
        )
        return PresignedUpload(url=post["url"], fields=dict(post["fields"]))

    def head_size(self, key: str) -> int | None:
        """The object's size in bytes, or ``None`` on a miss.

        Other errors propagate so an outage is not read as an absent object.
        """
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            # 403 is a miss too: without s3:ListBucket, S3 answers HEAD on a
            # missing key with 403 (the runtime IAM user is object-level only).
            if status in (403, 404):
                return None
            raise
        return int(response["ContentLength"])


def get_storage() -> Storage:
    if settings.storage_backend == "s3":
        return S3Storage(
            bucket=settings.s3_bucket,
            region=settings.aws_region,
            cloudfront_domain=settings.cloudfront_domain,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
    return LocalStorage(settings.local_storage_dir)


def scrub_log(value: str) -> str:
    """Strip CR/LF so a user-supplied value cannot forge log entries (``py/log-injection``).

    Every log interpolation of a user-influenced string goes through this.
    """
    return value.replace("\r", "").replace("\n", "")


def content_sha256(data: bytes) -> str:
    """The ``Media.sha256`` digest of a bytes payload (the re-import upsert compares against it)."""
    return hashlib.sha256(data).hexdigest()


def sweep_keys(keys: list[str], *, context: str) -> None:
    """Best-effort delete of storage keys; every failure is logged and swallowed.

    Commit-then-sweep: call this AFTER the DB transaction settles, so a storage
    failure cannot turn a committed state into a 500 and a live key is never
    stranded under a deleted row. A failure leaves an orphan, logged for a
    manual sweep.

    ``context`` is a short log phrase, e.g. ``f"event {geo.id} hard-delete"``.
    """
    if not keys:
        return
    # ``context`` can embed user-influenced strings (source URL, title).
    context = scrub_log(context)
    try:
        get_storage().delete_many(keys)
    except StorageDeleteError as exc:
        logger.exception(
            "S3 sweep failed (%s): %d/%d object(s) failed to delete; orphans may remain",
            context,
            len(exc.errors),
            len(keys),
        )
    except Exception:
        logger.exception(
            "S3 sweep failed (%s): unexpected error; %d candidate object(s); orphans may remain",
            context,
            len(keys),
        )


def derivative_key(original_key: str, suffix: str) -> str:
    """Sibling key for a hero / thumbnail derivative, always ``.jpg``.

    ``uploads/abc/xyz.png`` + ``thumb`` gives ``uploads/abc/xyz_thumb.jpg``.
    Mirrored by `lib/mediaUrls.ts`; change both or nothing renders.
    """
    # ``PurePosixPath``: S3 keys use forward slashes on every platform.
    p = PurePosixPath(original_key)
    stem_path = p.with_suffix("")
    return f"{stem_path}_{suffix}.jpg"


def validate_bytes(data: bytes, content_type: str) -> str:
    """Type + size validation for bytes-source media; returns the media_type.

    The :func:`validate_file` twin for fetched or read-from-disk files; without
    it an unbounded image would be buffered and re-encoded on the single worker.
    Raises ``ValueError``.
    """
    media_type, max_size = _media_type_and_max_size(content_type)
    if len(data) > max_size:
        raise ValueError(f"File too large: {len(data)} bytes (max {max_size})")
    return media_type


class PreparedMedia(NamedTuple):
    """Media whose strip + derivative work is done, so one result can be uploaded to several keys."""

    cleaned: bytes
    hero: bytes | None
    thumb: bytes | None
    content_type: str


def prepare_media(
    data: bytes, content_type: str, *, produce_derivatives: bool = True
) -> PreparedMedia:
    """Strip metadata + (optionally) build hero/thumb JPEGs. Sync and CPU-bound, so run in a thread.

    ``content_type`` is the stored type and, for an image, the output encoding
    (``strip_metadata`` re-encodes to it), which normalises machine-fetched
    photos (``tweet_ingest.records.PHOTO_CONTENT_TYPE``). Non-images pass
    through unstripped.
    """
    # Local import avoids an eager Pillow load at process start.
    from app.services.evidence_processing import (
        HERO_MAX_DIM,
        THUMBNAIL_MAX_DIM,
        make_jpeg_derivative,
        strip_metadata,
    )

    if content_type not in ALLOWED_IMAGE_TYPES:
        # Video / other: no strip, no derivatives (already buffered by the
        # caller and capped by ``validate_bytes``).
        return PreparedMedia(data, None, None, content_type)
    cleaned = strip_metadata(data, content_type)
    if not produce_derivatives:
        return PreparedMedia(cleaned, None, None, content_type)
    hero = make_jpeg_derivative(cleaned, content_type, HERO_MAX_DIM)
    thumb = make_jpeg_derivative(cleaned, content_type, THUMBNAIL_MAX_DIM)
    return PreparedMedia(cleaned, hero, thumb, content_type)


async def upload_prepared_media(prepared: PreparedMedia, key: str) -> UploadResult:
    """Upload prepared media to ``key``; the sha256 is of the cleaned original.

    A mid-flight failure sweeps whatever landed before re-raising, so the
    bucket never holds an original without its derivatives.
    """
    from app.services.evidence_processing import DERIVATIVE_CONTENT_TYPE

    storage = get_storage()
    if prepared.hero is None or prepared.thumb is None:
        return await storage.upload_bytes(prepared.cleaned, key, prepared.content_type)

    hero_key = derivative_key(key, "hero")
    thumb_key = derivative_key(key, "thumb")
    uploaded: list[str] = []
    try:
        result = await storage.upload_bytes(prepared.cleaned, key, prepared.content_type)
        uploaded.append(key)
        await storage.upload_bytes(prepared.hero, hero_key, DERIVATIVE_CONTENT_TYPE)
        uploaded.append(hero_key)
        await storage.upload_bytes(prepared.thumb, thumb_key, DERIVATIVE_CONTENT_TYPE)
        uploaded.append(thumb_key)
    except Exception:
        if uploaded:
            try:
                storage.delete_many(uploaded)
            except Exception:
                logger.exception(
                    "Failed to sweep partial-upload derivatives after error: %s",
                    uploaded,
                )
        raise
    return result._replace(derivative_keys=(hero_key, thumb_key))


async def upload_bytes_with_optional_strip(
    data: bytes,
    content_type: str,
    key: str,
    *,
    produce_derivatives: bool = True,
) -> UploadResult:
    """Validate, strip and upload media held as bytes (fetched tweet images, archive files).

    Bytes-source sibling of :func:`_upload_with_optional_strip`. Images lose
    EXIF/IPTC/XMP/ICC and get hero/thumb JPEGs (``produce_derivatives``); video
    uploads as is. The re-encode runs in a thread.
    """
    validate_bytes(data, content_type)
    prepared = await asyncio.to_thread(
        prepare_media, data, content_type, produce_derivatives=produce_derivatives
    )
    return await upload_prepared_media(prepared, key)


async def _upload_with_optional_strip(
    file: UploadFile,
    key: str,
    *,
    produce_derivatives: bool = True,
) -> UploadResult:
    """Dispatch a multipart upload by content type.

    * **Image**: buffered (bounded by ``max_image_size``) off the event loop,
      then :func:`upload_bytes_with_optional_strip`. ``produce_derivatives=False``
      for proof images, which render from the raw URL (derivatives would be
      unfetched objects locked 365 days under Object Lock).
    * **Video**: streamed via ``upload`` with no strip (it needs ffmpeg and
      buffering a 95 MiB MP4 would OOM the worker) and no derivatives.
    """
    if file.content_type in ALLOWED_IMAGE_TYPES:
        content_type = file.content_type or ""

        def _read() -> bytes:
            file.file.seek(0)
            return file.file.read()

        raw = await asyncio.to_thread(_read)
        return await upload_bytes_with_optional_strip(
            raw, content_type, key, produce_derivatives=produce_derivatives
        )
    return await get_storage().upload(file, key)


async def upload_file(file: UploadFile, geolocation_id: UUID) -> UploadResult:
    ext = safe_storage_extension(file.content_type)
    key = f"uploads/{geolocation_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key)


def detected_media_key(geolocation_id: UUID, content_type: str) -> str:
    """S3 key for a machine detection's media, under ``detected/`` to separate it from ``uploads/``.

    A bot-opened request stores footage under ``uploads/`` like a manual one."""
    ext = safe_storage_extension(content_type)
    return f"detected/{geolocation_id}/{uuid4()}{ext}"


async def upload_proof_image(file: UploadFile, user_id: UUID) -> UploadResult:
    """Inline image embedded in a Tiptap proof body, under a per-user prefix.

    Always an image (intake rejects the rest). Skips derivatives: the image
    renders from the raw URL, so hero/thumb would be unfetched objects locked
    365 days under Object Lock.
    """
    ext = safe_storage_extension(file.content_type)
    key = f"proof/{user_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key, produce_derivatives=False)


# Objects under this prefix are profile pictures this codebase minted; it
# marks a key as ours to delete.
AVATAR_KEY_PREFIX = "avatars/"


def avatar_key_of(url: str | None) -> str | None:
    """The avatar key ``url`` addresses, or ``None``.

    Asked before any picture delete: only our own bucket and the ``avatars/``
    prefix qualify, so other objects are left alone.
    """
    if not url:
        return None
    key = get_storage().key_from_url(url)
    if key is None or not key.startswith(AVATAR_KEY_PREFIX):
        return None
    return key


def avatar_key(user_id: UUID) -> str:
    """Storage key for an analyst's next profile picture, always ``.jpg`` (see :func:`render_avatar_jpeg`)."""
    return f"{AVATAR_KEY_PREFIX}{user_id}/{uuid4()}.jpg"


def render_avatar_jpeg(data: bytes, content_type: str) -> bytes:
    """Turn image bytes into the single JPEG an avatar is stored as.

    Metadata stripped, longer edge fit to ``THUMBNAIL_MAX_DIM``, re-encoded as
    JPEG. One object only: avatars render at 44 px or smaller, so siblings
    would be unfetched objects locked 365 days under Object Lock.

    ``content_type`` must be in :data:`ALLOWED_IMAGE_TYPES` (the caller
    checks; anything else passes through the transforms unchanged).

    Sync and CPU-bound. Raises ``EvidenceProcessingError`` for an unreadable
    image or one over ``MAX_AVATAR_DECODED_PIXELS``.
    """
    # Local import, as in ``prepare_media``.
    from app.services.evidence_processing import (
        MAX_AVATAR_DECODED_PIXELS,
        THUMBNAIL_MAX_DIM,
        make_jpeg_derivative,
        strip_metadata,
    )

    cleaned = strip_metadata(data, content_type, max_pixels=MAX_AVATAR_DECODED_PIXELS)
    return make_jpeg_derivative(cleaned, content_type, THUMBNAIL_MAX_DIM)


async def upload_avatar_image(file: UploadFile, user_id: UUID) -> UploadResult:
    """Store one analyst's profile picture. Images only (nothing would resize a video).

    Raises ``ValueError``; the router maps it to a 422.
    """
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(f"File type {content_type or 'unknown'} not allowed for an avatar")
    validate_file(file)

    def _render() -> bytes:
        file.file.seek(0)
        return render_avatar_jpeg(file.file.read(), content_type)

    data = await asyncio.to_thread(_render)
    return await get_storage().upload_bytes(data, avatar_key(user_id), "image/jpeg")


# 255: common filesystem-name max (NTFS / ext4), above any camera filename.
# Mirrored by `lib/proofImages.ts` (``safe_original_filename``).
ORIGINAL_FILENAME_MAX_LEN = 255

# Rejected in a stored filename: ``Cc`` (control chars) and ``Cf`` (format
# chars: RTL overrides, zero-width joiners, BOM), used to disguise an
# extension (``image.j[U+202E]gpj`` renders as ``image.jpg``) or smuggle
# markers past log parsers. By category, since new Unicode revisions add
# format chars a fixed list would miss.
_BAD_UNICODE_CATEGORIES = frozenset({"Cc", "Cf"})


def safe_original_filename(name: str | None) -> str | None:
    """Sanitise the attacker-controlled multipart ``filename`` before persisting.

    It surfaces on the public ``MediaRead`` API, so a future renderer could
    expose stored XSS; this is defence in depth beside output-escaping.

    * Strip directory components (both slash kinds).
    * Reject every ``_BAD_UNICODE_CATEGORIES`` codepoint.
    * Cap at ``ORIGINAL_FILENAME_MAX_LEN``.
    * Return ``None`` when empty so the column stays NULL, not ``""``.

    HTML / URL chars (``< > & " '``) pass through: output-escaping is their
    defence, and stripping would corrupt names containing ``&``.
    """
    if not name:
        return None
    # Backslash-aware: ``Path.name`` on POSIX wouldn't strip ``..\\..\\foo.jpg``.
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        return None
    if any(unicodedata.category(c) in _BAD_UNICODE_CATEGORIES for c in name):
        return None
    return name[:ORIGINAL_FILENAME_MAX_LEN]
