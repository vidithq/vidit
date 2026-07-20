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

# 64 KB chunk balances per-chunk syscall overhead against bounded memory:
# one chunk in memory during the hash, regardless of file size.
_HASH_CHUNK_SIZE = 64 * 1024


class UploadResult(NamedTuple):
    """What an ``upload`` / ``upload_bytes`` call hands back.

    ``sha256`` is persisted on the ``Media`` row as a stable content
    fingerprint. The S3 ETag is unfit: MD5 for non-multipart, not stable
    across copies.

    ``derivative_keys`` are the sibling S3 keys this upload landed alongside
    the original (hero + thumbnail for images, empty for videos). Callers add
    them to their row-creation cleanup list so a failed DB commit sweeps the
    derivatives too, instead of leaving indexable derivatives with no Media
    row pointing at them.
    """

    url: str
    sha256: str  # hex-encoded, always 64 chars
    derivative_keys: tuple[str, ...] = ()


def _hash_uploadfile(file: UploadFile) -> str:
    """Stream-hash the bytes behind an ``UploadFile``, rewinding after.

    Bounded memory (one chunk regardless of file size) over
    ``hashlib.sha256(await file.read())``, which would pin up to
    ``max_video_size`` (95 MiB) per concurrent upload on the Railway worker.
    Seeks back to 0 so the caller can hand the same file to a streaming
    uploader.
    """
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
    """Raised when one or more keys could not be deleted from storage.

    Carries the failing keys + per-key error message so callers can
    surface a diagnostic rather than swallow silent partial failures (boto3
    reports per-key errors in the response, not via exception).
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

# Extension derived from the validated MIME, NOT ``file.filename`` (fully
# attacker-controlled): a 2000-char suffix can blow past S3's 1024-byte key
# limit, an RTL-override can disguise the ext, and a hostile ``.html`` on a
# ``video/mp4`` payload makes a key whose name lies about its content. MIME
# guarantees a short ASCII suffix.
_EXTENSION_FOR_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


def _safe_storage_extension(content_type: str | None) -> str:
    """Return the canonical extension for an allowed MIME type.

    Falls back to ``""`` for anything off the map — safer than emitting an
    attacker-controlled string into an S3 key.
    """
    if content_type is None:
        return ""
    return _EXTENSION_FOR_CONTENT_TYPE.get(content_type, "")


LOCAL_STORAGE_MOUNT_PATH = "/local-storage"
# One home for the dev API origin: the static mount URL and the dev staging
# upload URL both derive from it, so a port change has one spot to touch.
LOCAL_DEV_BASE_URL = "http://localhost:8000"
LOCAL_STORAGE_URL_PREFIX = f"{LOCAL_DEV_BASE_URL}{LOCAL_STORAGE_MOUNT_PATH}"

# The dev/CI stand-in for the S3 POST-policy target (see ``main.py``, mounted
# only when STORAGE_BACKEND=local): accepts the same field + file form the
# browser would send S3 and writes the key through ``LocalStorage``.
DEV_STAGING_UPLOAD_PATH = "/dev/staging-upload"


class PresignedUpload(NamedTuple):
    """One browser-side direct-to-storage upload: POST a multipart form to
    ``url`` carrying every ``fields`` entry ahead of the file part. The same
    shape for both backends, so the frontend has a single upload code path."""

    url: str
    fields: dict[str, str]


def _media_type_and_max_size(content_type: str | None) -> tuple[str, int]:
    """Resolve an allowed MIME to ``(media_type, max byte size)``.

    The one place :func:`validate_file` (multipart) and :func:`validate_bytes`
    (bytes) agree on the type allowlist + per-type size ceiling, so they can't
    drift. Raises ``ValueError`` on a disallowed type.
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
    def list_keys(self, prefix: str) -> list[str]: ...
    def get_bytes(self, key: str) -> bytes: ...
    def get_to_path(self, key: str, dest: Path) -> None: ...
    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None: ...
    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload: ...
    def head_size(self, key: str) -> int | None: ...


class LocalStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Containment check at the single chokepoint every read/write funnels
        # through: keys are internally minted today, but an absolute or
        # dot-dot key must never escape the storage root.
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError(f"Storage key escapes the root: {key!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def upload(self, file: UploadFile, key: str) -> UploadResult:
        # Read once into memory: we hash the bytes anyway and size is bounded
        # by ``max_image_size`` / ``max_video_size``, so buffering is fine.
        file.file.seek(0)
        data = await file.read()
        sha256 = hashlib.sha256(data).hexdigest()
        self._path(key).write_bytes(data)
        return UploadResult(url=self.public_url(key), sha256=sha256)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult:
        sha256 = hashlib.sha256(data).hexdigest()
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
            # Best-effort: remove parent dirs we just emptied (e.g.
            # proof/<user>/ once its last image is gone). Stops at root.
            parent = path.parent
            while parent != self.root and parent.is_dir():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent

    def list_keys(self, prefix: str) -> list[str]:
        """List every key whose path starts with `prefix` (recursive).

        Mirrors S3's list_objects_v2 semantics (recursive walk, keys
        relative to the storage root) so the demo seeder discovers
        `demo-pool/` templates the same way against either backend.
        """
        base = self.root / prefix
        if not base.exists():
            return []
        keys: list[str] = []
        for path in base.rglob("*"):
            if path.is_file():
                keys.append(str(path.relative_to(self.root)).replace("\\", "/"))
        return sorted(keys)

    def get_bytes(self, key: str) -> bytes:
        """Read the raw bytes at ``key``. Raises ``FileNotFoundError`` on
        miss; callers handle.
        """
        return self._path(key).read_bytes()

    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None:
        """Sync sibling of ``upload_bytes`` for callers (seed) that don't
        need the sha256 / UploadResult shape.
        """
        # ``content_type`` accepted to match the protocol, but local-disk
        # storage carries no MIME metadata — FastAPI's StaticFiles infers
        # Content-Type from the extension on the localhost URL.
        del content_type
        self._path(key).write_bytes(data)

    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload:
        """Point the browser at the dev upload endpoint with the same field
        shape S3's POST policy would return, so the frontend upload code is
        identical against either backend. ``max_bytes`` is unused here: the
        dev endpoint re-reads the guard itself (a form field would be
        client-tamperable, and dev/CI archives are small anyway).
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
        # Two passes: (1) stream-hash in 64 KB chunks (see
        # ``_hash_uploadfile``); (2) hand the rewound file to
        # ``upload_fileobj`` for multipart-streamed PUTs without buffering.
        # The old ``put_object(Body=await file.read())`` pinned the entire
        # video (up to ``max_video_size``, 95 MiB) per upload, an OOM line on
        # the single Railway worker under a multi-file post.
        sha256 = _hash_uploadfile(file)
        extra_args = {"ContentType": file.content_type} if file.content_type else {}
        # ``upload_fileobj`` is sync; ``to_thread`` keeps the event loop free
        # so a slow upload doesn't starve siblings on the one worker.
        await asyncio.to_thread(
            self.client.upload_fileobj,
            file.file,
            self.bucket,
            key,
            ExtraArgs=extra_args,
        )
        return UploadResult(url=self.public_url(key), sha256=sha256)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult:
        # Caller already holds the bytes, so streaming buys nothing. The
        # ``to_thread`` wrap still matters: the seeder mints hundreds of rows
        # in a tight loop, and a blocking ``put_object`` per row would starve
        # the loop.
        sha256 = hashlib.sha256(data).hexdigest()
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
        # S3 DeleteObjects accepts up to 1000 keys/call and does NOT raise
        # on per-key failures — they're in the response Errors[] array.
        # Aggregate across chunks and raise once.
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

    def list_keys(self, prefix: str) -> list[str]:
        """List every key under `prefix` via paginated list_objects_v2.

        Returns keys exactly as S3 stores them.
        """
        keys: list[str] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj.get("Key")
                if key:
                    keys.append(key)
        return sorted(keys)

    def get_bytes(self, key: str) -> bytes:
        """Read the raw bytes at ``key`` from S3. Raises whatever
        ``get_object`` raises on miss (boto3 ``NoSuchKey`` / 404).
        """
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def get_to_path(self, key: str, dest: Path) -> None:
        """Stream the object at ``key`` to ``dest`` without buffering it in
        memory: the staged archive guard is 2 GB, far past what a worker
        process can hold, so the whole-object ``get_bytes`` is off-limits for
        staged zips.
        """
        self.client.download_file(self.bucket, key, str(dest))

    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None:
        """Sync sibling of ``upload_bytes`` for callers (seed) that don't
        need the sha256 / UploadResult.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def presign_staging_upload(
        self, key: str, *, max_bytes: int, content_type: str
    ) -> PresignedUpload:
        """A POST policy, not a presigned PUT: only the POST form supports
        ``content-length-range``, so S3 itself rejects an over-``max_bytes``
        body instead of trusting the client. Conditions pin the exact key and
        content type; 15 minutes covers a slow connection without leaving a
        long-lived write grant in the wild. Local signing, no network call.
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
        """The object's size in bytes, or ``None`` when the key holds nothing.
        Any error other than a miss propagates; callers must not read a
        storage outage as an absent object.
        """
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            # 403 is also a miss here: without s3:ListBucket, S3 answers
            # HeadObject on a nonexistent key with 403, not 404 (the runtime
            # IAM user carries object-level permissions only). Every key we
            # HEAD is one we minted under a writable prefix, so a forbidden
            # answer can only mean the object does not exist.
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
    """Strip CR/LF before a user-supplied value enters a log line.

    A crafted URL or filename carrying embedded newlines could otherwise
    forge extra log entries (``py/log-injection``). Single home for the
    scrubber: every log interpolation of a user-influenced string goes
    through this first (``sweep_keys`` below, the tweet-import router).
    """
    return value.replace("\r", "").replace("\n", "")


def sweep_keys(keys: list[str], *, context: str) -> None:
    """Best-effort delete a list of storage keys; swallow + log every failure.

    Callers reach this AFTER the DB transaction has committed (or rolled
    back): a storage failure must not propagate and turn a settled DB state
    into a retryable 500. A failed delete leaves an orphaned object, the
    accepted residual risk, logged for a manual sweep.

    ``context`` is a short caller phrase for the log, e.g.
    ``f"event {geo.id} hard-delete"``.
    """
    if not keys:
        return
    # ``context`` can embed user-influenced strings (a detection source URL,
    # an event title): scrub before it reaches the log.
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
    """Build the sibling key for a hero / thumbnail derivative.

    Always JPEG so the extension is forced regardless of source format —
    see ``make_jpeg_derivative`` for why.

    Examples
    --------
    >>> derivative_key("uploads/abc/xyz.jpg", "hero")
    'uploads/abc/xyz_hero.jpg'
    >>> derivative_key("uploads/abc/xyz.png", "thumb")
    'uploads/abc/xyz_thumb.jpg'
    >>> derivative_key("demo-pool/geo-01/media/photo.webp", "hero")
    'demo-pool/geo-01/media/photo_hero.jpg'

    The frontend mirrors this convention in ``mediaUrls()`` — the two
    layers must agree on the naming or nothing renders.
    """
    # ``PurePosixPath`` because S3 keys are always forward-slash separated;
    # ``Path`` on Windows would render the stem with backslashes and break
    # the convention.
    p = PurePosixPath(original_key)
    stem_path = p.with_suffix("")
    return f"{stem_path}_{suffix}.jpg"


def validate_bytes(data: bytes, content_type: str) -> str:
    """Type + size validation for a bytes-source upload; returns the media_type.

    The symmetric guard to :func:`validate_file` for media that never arrived as
    a multipart ``UploadFile`` (a fetched / read-from-disk archive file). Without
    it the bytes path would buffer + re-encode an unbounded image in memory on
    the single worker — the OOM line the video path avoids — and accept any MIME.
    Raises ``ValueError``; the caller maps it to its own error / skip.
    """
    media_type, max_size = _media_type_and_max_size(content_type)
    if len(data) > max_size:
        raise ValueError(f"File too large: {len(data)} bytes (max {max_size})")
    return media_type


class PreparedMedia(NamedTuple):
    """An image / video whose CPU-bound strip + derivative work is already done,
    so a caller can compute it once and upload the result to several keys (a
    multi-coordinate thread shares one image across its coordinate rows)."""

    cleaned: bytes
    hero: bytes | None
    thumb: bytes | None
    content_type: str


def prepare_media(
    data: bytes, content_type: str, *, produce_derivatives: bool = True
) -> PreparedMedia:
    """Strip metadata + (optionally) build hero/thumb JPEGs. Sync, CPU-bound —
    callers run it in a thread. Non-image types pass through unstripped."""
    # Local import keeps the storage module free of an eager Pillow load
    # (libjpeg / libpng C extensions at process start).
    from app.services.evidence_processing import (
        HERO_MAX_DIM,
        THUMBNAIL_MAX_DIM,
        make_jpeg_derivative,
        strip_metadata,
    )

    if content_type not in ALLOWED_IMAGE_TYPES:
        # Video / other: no strip, no derivatives. Unlike the multipart path
        # this holds the whole file in memory — the caller already buffered it,
        # and ``validate_bytes`` caps it at ``max_video_size``. (No video reaches
        # this path today; the archive adapter ingests photos only.)
        return PreparedMedia(data, None, None, content_type)
    cleaned = strip_metadata(data, content_type)
    if not produce_derivatives:
        return PreparedMedia(cleaned, None, None, content_type)
    hero = make_jpeg_derivative(cleaned, content_type, HERO_MAX_DIM)
    thumb = make_jpeg_derivative(cleaned, content_type, THUMBNAIL_MAX_DIM)
    return PreparedMedia(cleaned, hero, thumb, content_type)


async def upload_prepared_media(prepared: PreparedMedia, key: str) -> UploadResult:
    """Upload an already-prepared media (cleaned + optional derivatives) to ``key``.

    The sha256 lands on the cleaned original (derivatives are regeneratable). A
    mid-flight derivative-upload failure best-effort sweeps whatever landed
    before re-raising, so the bucket never holds an original with no derivatives.
    """
    storage = get_storage()
    if prepared.hero is None or prepared.thumb is None:
        return await storage.upload_bytes(prepared.cleaned, key, prepared.content_type)

    hero_key = derivative_key(key, "hero")
    thumb_key = derivative_key(key, "thumb")
    uploaded: list[str] = []
    try:
        result = await storage.upload_bytes(prepared.cleaned, key, prepared.content_type)
        uploaded.append(key)
        await storage.upload_bytes(prepared.hero, hero_key, "image/jpeg")
        uploaded.append(hero_key)
        await storage.upload_bytes(prepared.thumb, thumb_key, "image/jpeg")
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
    """Validate + strip + upload media the caller already holds as bytes.

    The bytes-source sibling of :func:`_upload_with_optional_strip`, for media
    that never arrived as a multipart ``UploadFile`` — a tweet image fetched from
    the X CDN, an archive file read from disk. Validates type + size
    (:func:`validate_bytes`), strips EXIF/IPTC/XMP/ICC + builds JPEG hero/thumb
    for images (``produce_derivatives``), plain-uploads video. The re-encode is
    sync CPU-bound, so it runs in a thread.
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

    * **Image** — buffer the body (bounded by ``max_image_size``) off the event
      loop, then hand the bytes to :func:`upload_bytes_with_optional_strip`,
      which strips metadata and (optionally) builds the hero/thumbnail JPEGs.
      ``produce_derivatives=False`` for ``upload_proof_image``: inline proof
      images render from the raw ``storage_url``, so hero/thumb JPEGs would be
      unfetched objects retained 365 days under Object Lock.

    * **Video** — no strip (needs ffmpeg / mp4-atom rewriting) and no
      derivatives; stream-hash + ``upload_fileobj`` via ``upload``, memory
      bounded at one chunk. Buffering a max-size (95 MiB) MP4 to strip it is the OOM line
      a prior PR caught — which is why EXIF strip can't run on videos.
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
    # Video path — stream-hash + upload_fileobj. No derivatives.
    return await get_storage().upload(file, key)


async def upload_file(file: UploadFile, geolocation_id: UUID) -> UploadResult:
    ext = _safe_storage_extension(file.content_type)
    key = f"uploads/{geolocation_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key)


def detected_media_key(geolocation_id: UUID, content_type: str) -> str:
    """S3 key for a machine detection's media — a distinct ``detected/`` prefix
    keeps it separable from human ``uploads/``. The extension derives from the
    validated MIME (a safe short ASCII suffix), never an attacker filename."""
    ext = _safe_storage_extension(content_type)
    return f"detected/{geolocation_id}/{uuid4()}{ext}"


async def upload_proof_image(file: UploadFile, user_id: UUID) -> UploadResult:
    """Inline image embedded in a Tiptap proof body.

    Per-user prefix, the convention from the editor-upload era, kept so
    existing proof URLs and new ones live under one shape. Always an image
    (evidence intake rejects everything else), so EXIF strip + buffered
    upload always applies.

    Skips derivatives: inline proof images render through Tiptap's
    ``<img src=…>`` via the raw storage URL, so hero/thumb JPEGs would be
    two unfetched objects per upload, locked 365 days under Object Lock.
    """
    ext = _safe_storage_extension(file.content_type)
    key = f"proof/{user_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key, produce_derivatives=False)


# 255 chars is the common filesystem-name max (NTFS / ext4), above any
# realistic phone-camera filename. A constant so routers and tests share
# one source of truth.
ORIGINAL_FILENAME_MAX_LEN = 255

# Unicode categories rejected in a stored filename:
#   ``Cc`` — control characters (NUL, newline, tab, ESC, 0x7F).
#   ``Cf`` — format characters: RTL/LTR overrides, bidi isolates,
#            zero-width joiners, BOM. Attackers use these to disguise the
#            extension (``image.j[U+202E]gpj`` renders as ``image.jpg`` but
#            ends ``.exe``) or smuggle markers past log parsers.
# Legitimate filenames never contain category-C codepoints. The category
# check beats enumerating codepoints — new Unicode revisions add format
# chars a fixed allow-list would miss.
_BAD_UNICODE_CATEGORIES = frozenset({"Cc", "Cf"})


def safe_original_filename(name: str | None) -> str | None:
    """Sanitise ``file.filename`` before persisting on a row.

    The multipart ``filename`` is fully attacker-controlled — path
    components (``../../etc/passwd``), NULs, newlines, control chars,
    RTL-override codepoints, HTML-shaped strings. Postgres TEXT stores all
    of it and it surfaces on the public ``MediaRead`` API, so any future
    renderer inserting it into a tag attr / HTML body / URL has a
    stored-XSS surface. Defence in depth on top of output-escaping.

    * **Strip directory components** via basename — both slash kinds, so a
      Windows-style path doesn't sneak through on POSIX.
    * **Reject every category-C codepoint** — see
      ``_BAD_UNICODE_CATEGORIES``.
    * **Cap at 255 chars** — see ``ORIGINAL_FILENAME_MAX_LEN``.
    * Return ``None`` for the empty / all-stripped case so the column stays
      NULL, not ``""``.

    HTML / URL chars (``< > & " '``) **pass through** — output-escaping is
    their right defence; sanitising here would corrupt legitimate filenames
    with ``&`` and clash with double-escape rules. Both layers are needed.
    """
    if not name:
        return None
    # Backslash-aware split covers ``..\\..\\foo.jpg`` on any platform
    # (``Path.name`` on POSIX wouldn't strip backslashes).
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        return None
    if any(unicodedata.category(c) in _BAD_UNICODE_CATEGORIES for c in name):
        return None
    return name[:ORIGINAL_FILENAME_MAX_LEN]
