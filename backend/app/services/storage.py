import asyncio
import hashlib
import logging
import unicodedata
from pathlib import Path, PurePosixPath
from typing import NamedTuple, Protocol
from uuid import UUID, uuid4

import boto3
from fastapi import UploadFile

from app.config import settings

logger = logging.getLogger(__name__)

# Chunk size for the hashing pre-pass. 64 KB balances per-chunk
# syscall overhead against keeping per-upload memory bounded — at most
# one chunk is in memory at a time during the hash, regardless of how
# big the underlying file is.
_HASH_CHUNK_SIZE = 64 * 1024


class UploadResult(NamedTuple):
    """What an ``upload`` / ``upload_bytes`` call hands back.

    ``url`` is the public URL the row should reference. ``sha256`` is the
    hex-encoded SHA-256 of the bytes that were written — captured at
    upload time and persisted on the ``Media`` / ``ProofImage`` row so
    every piece of evidence has a stable, queryable content fingerprint
    that survives storage-class changes and copy operations (unlike the
    S3 ETag, which is MD5 for non-multipart uploads and not stable
    across copies — so it isn't fit-for-purpose as a content hash).

    ``derivative_keys`` is the tuple of sibling S3 keys this upload
    landed on top of the original (hero + thumbnail for images,
    empty for videos). Callers add them to their row-creation cleanup
    list so a failed DB commit sweeps both the original and its
    derivatives — without this, a half-rolled-back upload would
    leave indexable derivatives with no Media row pointing at them.
    """

    url: str
    sha256: str  # hex-encoded, always 64 chars
    derivative_keys: tuple[str, ...] = ()


def _hash_uploadfile(file: UploadFile) -> str:
    """Stream-hash the bytes behind an ``UploadFile``.

    Seeks back to 0 first, reads the body in 64 KB chunks, returns the
    hex digest, then seeks back to 0 again so the caller can hand the
    same file straight to a streaming uploader (no re-read on the
    caller's side, no full-buffer in memory). Bounded memory: at most
    one chunk regardless of total file size — that's the whole point of
    this helper over ``hashlib.sha256(await file.read()).hexdigest()``,
    which would pin up to ``max_video_size = 100 MB`` per concurrent
    upload on the Railway worker.
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

    Carries the failing keys + the underlying error message per key so
    callers can surface a useful diagnostic rather than swallow silent
    partial failures (boto3 reports per-key errors in the response, not
    via exception).
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

# The S3 key extension is derived from the validated MIME, NOT from
# ``file.filename``. The multipart filename is fully attacker-controlled —
# a 2000-char suffix can blow past S3's 1024-byte key limit, an RTL-override
# can disguise the apparent ext, and a hostile ``.html`` extension on a
# ``video/mp4`` payload creates a confusing key whose visible name lies
# about the content. Deriving from MIME guarantees a short, ASCII,
# downstream-safe suffix.
_EXTENSION_FOR_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


def _safe_storage_extension(content_type: str | None) -> str:
    """Return the canonical extension for an allowed MIME type.

    ``content_type`` here is the value already validated by
    ``validate_file`` — i.e. one of ``ALLOWED_TYPES``. Falls back to ``""``
    (no extension) for anything off the map, which is safer than emitting
    an attacker-controlled string into an S3 key.
    """
    if content_type is None:
        return ""
    return _EXTENSION_FOR_CONTENT_TYPE.get(content_type, "")


LOCAL_STORAGE_MOUNT_PATH = "/local-storage"
LOCAL_STORAGE_URL_PREFIX = f"http://localhost:8000{LOCAL_STORAGE_MOUNT_PATH}"


def validate_file(file: UploadFile) -> str:
    """Validate file type and size. Returns media_type ('image' or 'video')."""
    if file.content_type not in ALLOWED_TYPES:
        raise ValueError(f"File type {file.content_type} not allowed")

    if file.content_type in ALLOWED_IMAGE_TYPES:
        media_type = "image"
        max_size = settings.max_image_size
    else:
        media_type = "video"
        max_size = settings.max_video_size

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
    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None: ...


class LocalStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def upload(self, file: UploadFile, key: str) -> UploadResult:
        # Read once into memory: we need to hash the bytes anyway and our
        # ceiling is bounded by ``max_image_size`` / ``max_video_size``
        # (10 MB / 100 MB today), so buffering is fine. Hash-while-streaming
        # is feasible but the extra code isn't worth it at these sizes.
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
            # Best-effort: walk back up emptying any parent dirs we just
            # made hollow (e.g. .local-storage/proof/<user>/ once their
            # last image is gone). Stops at the storage root.
            parent = path.parent
            while parent != self.root and parent.is_dir():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent

    def list_keys(self, prefix: str) -> list[str]:
        """List every key whose path starts with `prefix` (recursive).

        Used by the demo seeder to discover the templates dropped under
        `demo-pool/` without hardcoding the structure. Mirrors S3's
        list_objects_v2 semantics — recursive walk, returns keys
        relative to the storage root.
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
        """Read the raw bytes at ``key``. Sync — used by the demo seed
        prep pass to re-hash pool originals and derive thumbnails.
        Raises ``FileNotFoundError`` on miss; callers handle.
        """
        return self._path(key).read_bytes()

    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None:
        """Write bytes at ``key``. Sync sibling of ``upload_bytes`` for
        callers (seed) that are themselves sync and don't need the
        sha256 / UploadResult return shape.
        """
        # ``content_type`` is accepted to match the protocol signature
        # but local-disk storage doesn't carry MIME metadata; the
        # frontend reads files via the localhost URL prefix which
        # FastAPI's StaticFiles infers Content-Type from the extension.
        del content_type
        self._path(key).write_bytes(data)


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
        # Two-pass over the underlying file:
        #   1. Stream-hash in 64 KB chunks (bounded memory, regardless
        #      of file size — see ``_hash_uploadfile``).
        #   2. Hand the rewound file to ``upload_fileobj``, which does
        #      multipart-streamed PUTs without buffering the whole body.
        # The previous shape — ``data = await file.read()`` →
        # ``put_object(Body=data)`` — pinned the entire video (up to
        # ``max_video_size = 100 MB``) in memory per upload, which on a
        # multi-file form post against the single Railway worker is a
        # straight OOM line. The two-pass cost is one extra read of the
        # SpooledTemporaryFile (cheap, mostly memory or local disk) for
        # a multi-order-of-magnitude memory win.
        sha256 = _hash_uploadfile(file)
        extra_args = {"ContentType": file.content_type} if file.content_type else {}
        # ``upload_fileobj`` is sync; ``asyncio.to_thread`` keeps the
        # event loop free so a slow upload doesn't starve sibling
        # requests on the single uvicorn worker.
        await asyncio.to_thread(
            self.client.upload_fileobj,
            file.file,
            self.bucket,
            key,
            ExtraArgs=extra_args,
        )
        return UploadResult(url=self.public_url(key), sha256=sha256)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> UploadResult:
        # Caller already holds the bytes in memory, so streaming would
        # buy nothing — ``put_object`` is the right tool here. The
        # ``to_thread`` wrap matters all the same: the seeder mints
        # hundreds of demo rows in a tight loop, and a blocking
        # ``put_object`` per row would starve the loop the whole time.
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
        # S3 DeleteObjects accepts up to 1000 keys per call. boto3 does
        # NOT raise on per-key failures — they're reported in the
        # response Errors[] array. Aggregate across chunks and raise once
        # at the end so the caller (e.g. the reaper) sees a single
        # actionable error.
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

        Used by the demo seeder to discover templates dropped under
        `demo-pool/`. Returns keys exactly as S3 stores them.
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
        """Read the raw bytes at ``key`` from S3. Sync — used by the
        demo seed prep pass to re-hash pool originals and derive
        thumbnails. Raises whatever ``get_object`` raises on miss
        (boto3 ``NoSuchKey`` / 404); callers handle.
        """
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def put_bytes_sync(self, data: bytes, key: str, content_type: str) -> None:
        """Write bytes at ``key`` to S3. Sync sibling of
        ``upload_bytes`` for callers (seed) that are themselves sync
        and don't need the sha256 / UploadResult return shape.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )


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


def sweep_keys(keys: list[str], *, context: str) -> None:
    """Best-effort delete a list of storage keys; swallow + log every failure.

    Callers reach this AFTER the DB transaction they cared about has
    committed (or rolled back) — storage failures must not propagate up
    and turn a settled DB state into a 500 the client gets to retry. Per-key
    failures (``StorageDeleteError``) log the failed-key count; any other
    exception (network blip, auth failure mid-call) logs the candidate
    count. The proof-image reaper picks up survivors on its next sweep.

    ``context`` is a short caller-formatted phrase identifying the call site
    in logs, e.g. ``f"geolocation {geo.id} hard-delete"``.
    """
    if not keys:
        return
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

    ``suffix`` is the literal kind (``"hero"`` / ``"thumb"``). The
    derivative is always encoded as JPEG so the extension is forced
    regardless of the source format — see ``make_jpeg_derivative`` for
    why we don't preserve PNG / WebP for derivatives.

    Examples
    --------
    >>> derivative_key("uploads/abc/xyz.jpg", "hero")
    'uploads/abc/xyz_hero.jpg'
    >>> derivative_key("uploads/abc/xyz.png", "thumb")
    'uploads/abc/xyz_thumb.jpg'
    >>> derivative_key("demo-pool/geo-01/media/photo.webp", "hero")
    'demo-pool/geo-01/media/photo_hero.jpg'

    The frontend mirrors this convention in ``mediaUrls()`` — single
    source of truth that the two layers agree on the naming or
    nothing renders.
    """
    # ``PurePosixPath`` because S3 keys are always forward-slash
    # separated regardless of the host OS — using ``Path`` on Windows
    # would render the stem with backslashes and silently break the
    # structural-naming convention (the frontend's ``mediaUrls``
    # mirror always expects forward slashes). For local dev on macOS
    # / Linux this is identical to ``Path``.
    p = PurePosixPath(original_key)
    # ``with_suffix("")`` drops the trailing extension; the stem itself
    # may contain dots ("photo.v2.jpg" → "photo.v2"), which is fine.
    stem_path = p.with_suffix("")
    return f"{stem_path}_{suffix}.jpg"


async def _upload_with_optional_strip(
    file: UploadFile,
    key: str,
    *,
    produce_derivatives: bool = True,
) -> UploadResult:
    """Dispatch by content type.

    * **Image** (JPEG / PNG / WebP) — buffer the body (bounded by
      ``max_image_size``, default 10 MB), run it through
      ``services.evidence_processing.strip_metadata`` to drop EXIF
      (incl. submitter GPS), IPTC, XMP, ICC etc. When
      ``produce_derivatives`` is True (the default, used by
      ``upload_file`` + ``upload_bounty_file``), additionally
      generate two JPEG display derivatives (hero ≈ 1280 px,
      thumbnail ≈ 400 px) from the cleaned bytes and upload all
      three to storage (original at ``key``, hero at
      ``derivative_key(key, "hero")``, thumbnail at
      ``derivative_key(key, "thumb")``). The sha256 lands on the
      cleaned original — derivatives don't get their own hash because
      they're regeneratable from the original and the Media row only
      tracks one. An auditor downloading the original's public URL
      gets a file whose hash matches what we recorded.

      ``produce_derivatives=False`` is used by ``upload_proof_image``
      because inline proof images are rendered through Tiptap and
      reach the user via the raw ``storage_url`` rather than the
      structural-naming derivative path — producing the hero / thumb
      JPEGs would write S3 objects that nothing ever fetches, and
      keep them retained for 365 days under Object Lock. When the
      proof-image renderer eventually switches to derivatives (own
      slice), flip this argument back to ``True`` at the
      ``upload_proof_image`` call site.

    * **Video** — no metadata-strip path today (would need ffmpeg /
      mp4-atom rewriting; out of scope for slice 1 of evidence
      integrity) and no derivatives either (first-frame thumb is
      a separate slice). Stream-hash + stream-upload
      via ``upload`` — memory bounded at one chunk regardless of file
      size.

    The buffer-vs-stream split is the reason we can't run EXIF on
    videos here yet: stripping a 100 MB MP4 in memory is the
    OOM line the previous PR review caught.

    Both the body read (``file.file.read()``) and the libjpeg / libpng
    / libwebp re-encode are synchronous CPU-bound work. We run them
    through ``asyncio.to_thread`` so a slow encode (WebP method=6 on a
    multi-megapixel image is multi-second on commodity hardware)
    doesn't block the uvicorn event loop and starve sibling requests
    on the single Railway worker.

    On derivative-upload failure mid-flight the original (if it
    landed) and any uploaded derivative are best-effort swept before
    the exception propagates — so a half-uploaded triple doesn't
    leave an indexable original with no thumbnails the frontend can
    render. Caller still wraps in its own cleanup for the higher
    layer (Media row not yet committed).
    """
    # Local import — keeps the storage module free of an eager
    # Pillow load (which pulls in libjpeg / libpng C extensions at
    # process start). Pillow's import cost is small but the
    # evidence_processing module is the only legitimate consumer.
    from app.services.evidence_processing import (
        HERO_MAX_DIM,
        THUMBNAIL_MAX_DIM,
        make_jpeg_derivative,
        strip_metadata,
    )

    if file.content_type in ALLOWED_IMAGE_TYPES:
        content_type = file.content_type or ""

        def _read_strip_and_derive() -> tuple[bytes, bytes | None, bytes | None]:
            file.file.seek(0)
            raw = file.file.read()
            cleaned = strip_metadata(raw, content_type)
            if not produce_derivatives:
                return cleaned, None, None
            hero = make_jpeg_derivative(cleaned, content_type, HERO_MAX_DIM)
            thumb = make_jpeg_derivative(cleaned, content_type, THUMBNAIL_MAX_DIM)
            return cleaned, hero, thumb

        cleaned, hero, thumb = await asyncio.to_thread(_read_strip_and_derive)
        storage = get_storage()

        if hero is None or thumb is None:
            # Derivative-skipping path (proof images). Single-object
            # upload + empty derivative_keys so the caller's cleanup
            # list stays correct.
            return await storage.upload_bytes(cleaned, key, content_type)

        hero_key = derivative_key(key, "hero")
        thumb_key = derivative_key(key, "thumb")
        uploaded: list[str] = []
        try:
            result = await storage.upload_bytes(cleaned, key, content_type)
            uploaded.append(key)
            await storage.upload_bytes(hero, hero_key, "image/jpeg")
            uploaded.append(hero_key)
            await storage.upload_bytes(thumb, thumb_key, "image/jpeg")
            uploaded.append(thumb_key)
        except Exception:
            # Sweep whatever did land so the frontend doesn't observe
            # an original with no derivatives (or a derivative with no
            # original). The caller's own cleanup catches the row-side
            # consequence; this catches the bucket-side leak.
            if uploaded:
                try:
                    storage.delete_many(uploaded)
                except Exception:
                    logger.exception(
                        "Failed to sweep partial-upload derivatives after error: %s",
                        uploaded,
                    )
            raise
        # Augment the storage-layer result with the derivative keys so
        # the caller's row-creation rollback can sweep all three.
        return result._replace(derivative_keys=(hero_key, thumb_key))
    # Video path — pre-stream-hash + upload_fileobj. No derivatives.
    return await get_storage().upload(file, key)


async def upload_file(file: UploadFile, geolocation_id: UUID) -> UploadResult:
    ext = _safe_storage_extension(file.content_type)
    key = f"uploads/{geolocation_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key)


async def upload_bounty_file(file: UploadFile, bounty_id: UUID) -> UploadResult:
    """Bounty media — same shape as ``upload_file`` but under a distinct
    S3 prefix so the two upload classes are visually separable in the
    bucket. When slice 2 promotes a bounty to a geolocation we rewrite
    the row pointers, not the keys, so a fulfilled bounty's media stays
    at ``bounty_uploads/<bounty>/...`` even after ownership flips.
    """
    ext = _safe_storage_extension(file.content_type)
    key = f"bounty_uploads/{bounty_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key)


async def upload_proof_image(file: UploadFile, user_id: UUID) -> UploadResult:
    """Inline image embedded in a Tiptap proof body.

    Stored under a per-user prefix instead of per-geolocation because the
    image is uploaded from the editor before the geolocation row exists.
    Proof images are always images (the endpoint rejects everything
    else), so EXIF strip + buffered upload always applies.

    Skips the hero / thumbnail derivative production: inline proof
    images render through Tiptap's ``<img src=…>`` using the raw
    storage URL, never the derivative path. Producing them would
    write two JPEGs per upload that nothing ever fetches, locked for
    365 days under bucket-default Object Lock. When the proof-image
    renderer adopts derivatives, flip this back to the default.
    """
    ext = _safe_storage_extension(file.content_type)
    key = f"proof/{user_id}/{uuid4()}{ext}"
    return await _upload_with_optional_strip(file, key, produce_derivatives=False)


# Length cap for ``original_filename`` at insert time. 255 chars is the
# common filesystem-name max (NTFS / ext4) and comfortably above any
# realistic phone-camera filename. Set as a constant so the routers
# and tests share one source of truth.
ORIGINAL_FILENAME_MAX_LEN = 255

# Unicode general categories we reject in a stored filename:
#   ``Cc`` — control characters (NUL, newline, tab, ESC, 0x7F, etc).
#   ``Cf`` — format characters: RTL/LTR overrides (U+202A–E), bidi
#            isolates (U+2066–9), zero-width joiners (U+200B–D), BOM
#            (U+FEFF), and similar invisibles. Attackers use these
#            to visually disguise the file extension
#            (``image.j[U+202E]gpj`` → renders as ``image.jpg`` but
#            ends in ``.exe``) or smuggle markers past log parsers.
# Legitimate filenames never contain category-C codepoints. The
# explicit ``unicodedata.category`` check is safer than enumerating
# individual codepoints — new Unicode revisions add format chars
# that a fixed allow-list would miss.
_BAD_UNICODE_CATEGORIES = frozenset({"Cc", "Cf"})


def safe_original_filename(name: str | None) -> str | None:
    """Sanitise ``file.filename`` before persisting on a row.

    The multipart ``filename`` field is fully attacker-controlled — it
    can contain path components (``../../etc/passwd``), embedded
    NULs, newlines, control characters, RTL-override codepoints, or
    HTML-shaped strings. Postgres TEXT happily stores all of it, and
    the value surfaces on the public ``MediaRead`` API, so any future
    renderer that inserts the filename into a tag attribute / HTML
    body / URL has a stored-XSS surface waiting for it.

    Defence in depth: sanitise at insert time too, on top of whatever
    output-escaping the renderer adds.

    * **Strip directory components** via basename — both forward and
      back slashes are stripped so a Windows-style path doesn't sneak
      through on a POSIX runtime.
    * **Reject every category-C codepoint** (``Cc`` control + ``Cf``
      format) — see ``_BAD_UNICODE_CATEGORIES`` for the rationale.
      One general check catches NUL / newline / RTL overrides / bidi
      isolates / zero-width joiners / BOM together.
    * **Cap at 255 chars** — see ``ORIGINAL_FILENAME_MAX_LEN``.
    * Return ``None`` for the empty / all-stripped case so the
      column stays NULL rather than holding ``""``.

    HTML / URL chars (``< > & " '``) **pass through** verbatim — the
    output-escaping the renderer adds is the right defence for those.
    Sanitising HTML chars at insert would silently corrupt legitimate
    filenames containing ``&`` and clashes with double-escape rules
    on the renderer side. Both layers (insert sanitise + render
    escape) are needed; neither replaces the other.
    """
    if not name:
        return None
    # Strip both POSIX and Windows path components. Explicit
    # backslash-aware split covers ``..\\..\\foo.jpg`` regardless of
    # platform (``Path.name`` on POSIX wouldn't strip backslashes).
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        return None
    if any(unicodedata.category(c) in _BAD_UNICODE_CATEGORIES for c in name):
        return None
    return name[:ORIGINAL_FILENAME_MAX_LEN]
