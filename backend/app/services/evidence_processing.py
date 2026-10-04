"""Pre-storage transforms applied to uploaded evidence files.

``strip_metadata`` drops EXIF, GPS, camera make/model, IPTC, and embedded
thumbnails before image bytes reach S3: phone JPEGs carry the submitter's own
GPS, which must never reach viewers.

The sha256 in ``services/storage.py`` runs after the strip, so it matches what
an auditor recomputes from the public URL.

A round-trip re-encode is the only way to remove EXIF, ICC, XMP and IPTC
together (cutting the EXIF marker leaves GPS in IFD0 and IPTC in APP13).

Synchronous and CPU-bound: call via ``asyncio.to_thread`` (WebP method=6 on a
4000x4000 image takes seconds). Each decode waits for one of
``MAX_CONCURRENT_DECODES`` process-wide slots.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.storage import ALLOWED_IMAGE_TYPES

logger = logging.getLogger(__name__)


# Every type in ``storage.ALLOWED_IMAGE_TYPES`` is EXIF-strippable; split the
# sets if that stops holding.
_STRIPPABLE_IMAGE_TYPES = frozenset(ALLOWED_IMAGE_TYPES)

# The only decoders ``Image.open`` tries, whatever type an upload declares, so
# other formats fail to open. The declared type still decides the stored
# encoding. ``Image.MIME`` is populated once ``Image.init`` has run.
Image.init()
_ACCEPTED_FORMATS = tuple(
    sorted(fmt for fmt, mime in Image.MIME.items() if mime in ALLOWED_IMAGE_TYPES)
)
# One message for another format and for a damaged file: Pillow can't reliably tell them apart.
UNREADABLE_IMAGE_MESSAGE = (
    "Could not read this image: upload a valid "
    f"{', '.join(_ACCEPTED_FORMATS[:-1])} or {_ACCEPTED_FORMATS[-1]} file"
)

# Decompression-bomb cap: a 2 MB JPEG can decode to 12000x12000 (~580 MB RGB),
# enough to OOM the single worker. Pillow's default only warns at 89 MP and
# raises past 2x, too loose for a public endpoint. The check reads the lazy
# ``Image.open(...).size`` (header only) before ``img.load()`` allocates.
# 60 MP exceeds any phone or DSLR; raw RGBA at that size is ~240 MB.
MAX_DECODED_PIXELS = 60_000_000

# Ceiling for a profile picture (stored at ``THUMBNAIL_MAX_DIM``); admits the
# 24 MP a phone camera writes, since the picker uploads the file unresized.
MAX_AVATAR_DECODED_PIXELS = 25_000_000

# Never mutate ``Image.MAX_IMAGE_PIXELS``: a module-level set leaks the cap to
# every other Pillow consumer, and a scoped set/restore races across the
# ``asyncio.to_thread`` pool. The size check above works on locals.

# Images decoded at once. A decode holds its raster (up to 4 bytes per pixel)
# and encoder buffers until the encode returns; callers past the limit wait.
MAX_CONCURRENT_DECODES = 2
_decode_slots = threading.BoundedSemaphore(MAX_CONCURRENT_DECODES)


class EvidenceProcessingError(ValueError):
    """Raised when an image upload can't be metadata-stripped.

    A ``ValueError`` so the router's 400 handler picks it up.
    """


def _convert(image: Image.Image, mode: str) -> Image.Image:
    """Convert ``image`` to ``mode`` and close the source to free its raster before the encode."""
    converted = image.convert(mode)
    image.close()
    return converted


@contextmanager
def _guarded_open(data: bytes, max_pixels: int) -> Iterator[Image.Image]:
    """Open image bytes behind the pre-decode guards and yield a usable image.

    * ``Image.open`` is lazy, so the format check, the ``max_pixels`` ceiling
      and the animated-image refusal fire before ``load()`` allocates.
      ``is_animated`` exists only on multi-frame formats, hence the
      ``getattr``; flattening a clip would lose evidence, so it is rejected.
    * The whole body holds one of the ``MAX_CONCURRENT_DECODES`` slots (the
      WebP decoder allocates frame buffers on open).
    * Palette modes (``P``, ``PA``) become full colour. Alpha is kept via
      ``has_transparency_data``, since ``"transparency" in img.info`` misses
      ``PA``.
    """
    # Fresh BytesIO so ``img.load()`` detaches from the source bytes.
    with _decode_slots, Image.open(BytesIO(data), formats=_ACCEPTED_FORMATS) as img:
        width, height = img.size
        pixels = width * height
        if pixels > max_pixels:
            raise EvidenceProcessingError(
                f"Image dimensions {width}x{height} ({pixels} px) exceed the {max_pixels} pixel cap"
            )

        if getattr(img, "is_animated", False):
            raise EvidenceProcessingError(
                "Animated images are not supported. Upload as a video instead"
            )

        img.load()

        if img.mode in {"P", "PA"}:
            yield _convert(img, "RGBA" if img.has_transparency_data else "RGB")
        else:
            yield img


@contextmanager
def _decode_errors(context: str) -> Iterator[None]:
    """Map Pillow's failure modes onto :class:`EvidenceProcessingError`.

    ``context`` prefixes the log line. Unrecognised and damaged files share
    ``UNREADABLE_IMAGE_MESSAGE``; the log line tells them apart. Errors from
    :func:`_guarded_open` re-raise untouched so a bomb or animation rejection
    isn't logged as "cannot decode".
    """
    try:
        yield
    except EvidenceProcessingError:
        raise
    except Image.DecompressionBombError as exc:
        # Backstop: Pillow's own 89 MP tripwire fired before our size check.
        logger.warning("%s: Pillow DecompressionBombError: %s", context, exc)
        raise EvidenceProcessingError("Image rejected as a decompression bomb") from exc
    except UnidentifiedImageError as exc:
        logger.warning("%s: unidentified image: %s", context, exc)
        raise EvidenceProcessingError(UNREADABLE_IMAGE_MESSAGE) from exc
    except OSError as exc:
        logger.warning("%s: cannot decode image: %s", context, exc)
        raise EvidenceProcessingError(UNREADABLE_IMAGE_MESSAGE) from exc


def strip_metadata(data: bytes, content_type: str, *, max_pixels: int | None = None) -> bytes:
    """Return ``data`` with all metadata stripped.

    Non-image content (videos) passes through unchanged. JPEG / PNG / WebP are
    decoded and re-encoded:

    * **JPEG**: ``quality=95, subsampling=0`` (4:4:4 chroma keeps signage sharp).
    * **PNG**: ``optimize=True``; lossless, and keeps the original (under
      Object Lock) smallest.
    * **WebP**: ``quality=95, method=6``.

    The EXIF Orientation tag is applied to the pixels first, or portrait photos
    end up sideways everywhere.

    ``data`` may be any of the three formats whatever ``content_type`` declares;
    the result is always encoded as ``content_type``. ``max_pixels`` replaces
    ``MAX_DECODED_PIXELS``.

    Raises ``EvidenceProcessingError`` (router 400) for unsupported or
    corrupt images, decompression bombs, and animated images (re-encoding
    would drop frames; the analyst should upload a video).
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    with (
        _decode_errors(f"strip_metadata (content_type={content_type}, {len(data)} bytes)"),
        _guarded_open(data, MAX_DECODED_PIXELS if max_pixels is None else max_pixels) as image,
    ):
        ImageOps.exif_transpose(image, in_place=True)
        # Encoders write metadata only from kwargs and ``info``, so clearing
        # ``info`` strips it.
        image.info.clear()

        output = BytesIO()
        if content_type == "image/jpeg":
            # JPEG holds RGB or L only.
            if image.mode not in {"RGB", "L"}:
                image = _convert(image, "RGB")
            image.save(
                output,
                format="JPEG",
                quality=95,
                subsampling=0,
                optimize=True,
                progressive=False,
            )
        elif content_type == "image/png":
            if image.mode == "CMYK":  # a CMYK JPEG source; PNG has no CMYK
                image = _convert(image, "RGB")
            image.save(output, format="PNG", optimize=True)
        else:  # image/webp; the encoder converts any other mode itself
            image.save(output, format="WEBP", quality=95, method=6)
        return output.getvalue()


# Display derivatives. Hero = detail-page render (~1280 px); thumbnail = map
# popup / search card / form preview (~200-300 px CSS, doubled for 2x DPI).
# Quality 80 is indistinguishable from 95 at these sizes and 3-4x smaller.
# Originals are the evidence path; derivatives are the display path.
HERO_MAX_DIM = 1280
THUMBNAIL_MAX_DIM = 400
DERIVATIVE_JPEG_QUALITY = 80

# What :func:`make_jpeg_derivative` emits and the derivative PUT declares.
# Machine-imported photos use the same type
# (``tweet_ingest.records.PHOTO_CONTENT_TYPE``).
DERIVATIVE_CONTENT_TYPE = "image/jpeg"


def make_jpeg_derivative(data: bytes, content_type: str, max_dim: int) -> bytes:
    """Resize ``data`` so the longer edge fits ``max_dim`` and encode as JPEG.

    Pure CPU-bound transform; the caller owns S3 key naming
    (``..._hero.jpg`` / ``..._thumb.jpg``) and the ``image/jpeg`` PUT.

    Always JPEG, so the frontend can assume ``_hero.jpg`` / ``_thumb.jpg``.
    Alpha is discarded and renders black, not white; originals keep it.

    ``ImageOps.exif_transpose`` runs before resize for paths that skip the
    strip (the seed-pool prep reads raw bytes), or the derivative would be
    rotated relative to the original. No-op on stripped bytes.

    Same hardening as ``strip_metadata`` (safe standalone). No-op for
    non-image content types.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    with (
        _decode_errors(
            f"make_jpeg_derivative (content_type={content_type}, "
            f"max_dim={max_dim}, {len(data)} bytes)"
        ),
        _guarded_open(data, MAX_DECODED_PIXELS) as source,
    ):
        # Downscale before dropping alpha: in RGBA, LANCZOS is alpha-aware,
        # while RGB would bleed black from transparent pixels into the edges.
        ImageOps.exif_transpose(source, in_place=True)

        # ``thumbnail`` never upscales but still recompresses at the lower
        # quality, so output is consistent whatever the source size.
        source.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        # ``convert("RGB")`` discards alpha without compositing.
        if source.mode not in {"RGB", "L"}:
            source = _convert(source, "RGB")

        output = BytesIO()
        source.save(
            output,
            format="JPEG",
            quality=DERIVATIVE_JPEG_QUALITY,
            optimize=True,
            progressive=False,
        )
        return output.getvalue()
