"""Pre-storage transforms applied to uploaded evidence files.

``strip_metadata`` drops EXIF, GPS, camera make/model, IPTC, and embedded
thumbnails before image bytes reach S3. Phone-shot JPEGs commonly carry the
*submitter's own* GPS in EXIF; shipping that raw to every viewer via
CloudFront would compromise the OSINT analyst's safety.

The sha256 in ``services/storage.py`` runs **after** the strip (on the bytes
that land on S3), so the on-disk fingerprint matches what an auditor
recomputes from the public URL.

A round-trip re-encode is the only way to guarantee EXIF + ICC + XMP + IPTC
are all gone — snipping the EXIF marker alone leaves GPS in IFD0, IPTC in
APP13, etc. The cost is one JPEG recompression; ``quality=95, subsampling=0``
keeps the loss visually negligible.

Synchronous and CPU-bound — call via ``asyncio.to_thread`` from the upload
helper so the uvicorn event loop stays free during the libjpeg / libwebp
encode (WebP method=6 on a 4000×4000 image is multi-second on commodity
hardware).
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.storage import ALLOWED_IMAGE_TYPES

logger = logging.getLogger(__name__)


# Derived from the accepted-image allowlist (``ALLOWED_IMAGE_TYPES`` in
# ``services/storage.py``): today every accepted image type is EXIF-strippable,
# so the strip contract is exactly that set. Split them if an accepted image
# type is ever not EXIF-strippable.
_STRIPPABLE_IMAGE_TYPES = frozenset(ALLOWED_IMAGE_TYPES)

# Hard cap on decoded image dimensions. A decompression bomb is a small file
# (e.g. 2 MB JPEG) that decodes to a huge raster (12000 × 12000 ≈ 580 MB RGB
# / 770 MB RGBA), enough to OOM the single Railway worker from one request.
# Pillow's ``Image.MAX_IMAGE_PIXELS`` only *warns* at its default
# (89 478 485 px) and raises only past 2× — too loose for a public endpoint.
# We check the lazy ``Image.open(...).size`` (header parse, no decode) and
# refuse above our own ceiling before ``img.load()`` allocates.
#
# 60 MP is above any real phone / DSLR (~50 MP top-of-line); honest 100 MP
# astrophotography is rare enough that a clean 400 is acceptable. Raw RGBA
# for 60 MP is ≈ 240 MB, which the worker holds without thrashing.
MAX_DECODED_PIXELS = 60_000_000

# Deliberately do NOT mutate ``Image.MAX_IMAGE_PIXELS``. Both earlier
# attempts are wrong:
#
# * Module-level set leaks the cap onto every other Pillow consumer in the
#   process (admin OG-image routes, future thumbnailers).
# * Function-scoped set/restore races between concurrent strip calls in
#   the ``asyncio.to_thread`` pool: thread B may capture a thread-A-narrowed
#   value as its "original" and restore to it permanently.
#
# The explicit size check on the lazy ``Image.open(...).size`` is race-free
# (operates on locals) and fires before any pixel-buffer allocation, so the
# Pillow global cap is redundant.


class EvidenceProcessingError(ValueError):
    """Raised when an image upload can't be metadata-stripped.

    A ``ValueError`` subclass so the router's ``ValueError`` → 400 handler
    picks it up without bespoke wiring.
    """


@contextmanager
def _guarded_open(data: bytes) -> Iterator[Image.Image]:
    """Open image bytes behind the pre-decode guards and yield a usable image.

    One home for the hardening both transforms need:

    * ``Image.open`` is lazy (header parse, no pixel decode), so the
      decompression-bomb ceiling and the animated-image refusal both fire
      before ``load()`` would allocate 100s of MB. ``is_animated`` is only
      set on animatable formats (GIF / APNG / animated WebP), hence the
      ``getattr``; flattening a clip to one frame would lose an analyst's
      evidence, so it is a rejection rather than a silent drop.
    * Palette modes (``P``, ``PA``) store pixels as indexes into
      ``img.palette``, so ``tobytes()`` returns indexes rather than colour
      and a rebuild without the palette renders black / garbage. Convert to
      a full colour mode first, keeping alpha whenever the source carries
      any: ``has_transparency_data`` rather than ``"transparency" in
      img.info``, since the latter misses ``mode == "PA"`` (palette + alpha
      plane) and would flatten alpha to opaque.

    A palette source yields the converted copy; every other mode yields the
    opened ``ImageFile`` itself, which the ``with`` block closes on exit
    either way.
    """
    # Fresh BytesIO so ``img.load()`` can fully detach from the buffer;
    # otherwise PIL holds a reference to the source bytes for lazy decode.
    with Image.open(BytesIO(data)) as img:
        width, height = img.size
        pixels = width * height
        if pixels > MAX_DECODED_PIXELS:
            raise EvidenceProcessingError(
                f"Image dimensions {width}x{height} ({pixels} px) "
                f"exceed the {MAX_DECODED_PIXELS} pixel cap"
            )

        if getattr(img, "is_animated", False):
            raise EvidenceProcessingError(
                "Animated images are not supported. Upload as a video instead"
            )

        img.load()

        if img.mode in {"P", "PA"}:
            yield img.convert("RGBA" if img.has_transparency_data else "RGB")
        else:
            yield img


@contextmanager
def _decode_errors(context: str, *, undecodable: str) -> Iterator[None]:
    """Map Pillow's failure modes onto :class:`EvidenceProcessingError`.

    ``context`` prefixes the log line with the transform and its inputs;
    ``undecodable`` is the message a corrupt / truncated / format-mismatched
    file gets. The guards inside :func:`_guarded_open` already raise a shaped
    error, so that arm re-raises untouched: re-wrapping would log "cannot
    decode" for what was a bomb or animation rejection. Everything else logs
    for the Sentry rate and raises a clean ``ValueError`` so the router emits
    400, not 500.
    """
    try:
        yield
    except EvidenceProcessingError:
        raise
    except Image.DecompressionBombError as exc:
        # Pillow's default 89 MP tripwire fired (we don't override it).
        # Backstop in case it fires before our explicit size check.
        logger.warning("%s: Pillow DecompressionBombError: %s", context, exc)
        raise EvidenceProcessingError("Image rejected as a decompression bomb") from exc
    except (UnidentifiedImageError, OSError) as exc:
        logger.warning("%s: cannot decode image: %s", context, exc)
        raise EvidenceProcessingError(undecodable) from exc


def strip_metadata(data: bytes, content_type: str) -> bytes:
    """Return ``data`` with all metadata stripped.

    Non-image content (videos) passes through unchanged — the strip only
    applies to JPEG / PNG / WebP, which are decoded and re-encoded without
    metadata. Encoder params preserve visible quality:

    * **JPEG** — ``quality=95, subsampling=0`` (4:4:4 chroma so place-name
      signage stays sharp), ``optimize=True``, ``progressive=False`` for
      predictable size on small thumbnails.
    * **PNG** — ``optimize=True``; lossless, so the strip is pixel-free.
    * **WebP** — ``quality=95, method=6`` (best compression/quality).

    An EXIF Orientation tag is applied to the pixels first, so the stripped
    copy renders the way the camera meant it to. Dropping the tag without
    applying it is what leaves a portrait photo sideways everywhere it is
    served.

    Rejects (raises ``EvidenceProcessingError`` → router 400):

    * **Corrupt / truncated** images (Pillow can't decode the header).
    * **Decompression bombs** — dimensions above ``MAX_DECODED_PIXELS``,
      before pixel-buffer allocation.
    * **Animated** images (multi-frame GIF / APNG / animated WebP) —
      ``frombytes`` would silently flatten to one frame and an analyst
      submitting a clip-as-image would lose evidence; reject so they
      re-upload as a video.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    with (
        _decode_errors(
            f"strip_metadata (content_type={content_type}, {len(data)} bytes)",
            undecodable=f"Could not decode {content_type} for metadata stripping",
        ),
        _guarded_open(data) as source,
    ):
        # Bake the EXIF Orientation tag into the raster BEFORE the rebuild
        # below drops it. ``frombytes`` copies pixels exactly as stored, so
        # without this a phone photo shot in portrait keeps its landscape
        # raster and loses the one tag that told a viewer to rotate it: the
        # stripped copy renders sideways, and every derivative cut from it
        # inherits the rotation. Returns the source unchanged when there is
        # no orientation to apply.
        source = ImageOps.exif_transpose(source) or source
        # Rebuild from raw pixel bytes only, which drops the whole
        # ``img.info`` dict (EXIF, IPTC, XMP, ICC, JFIF, comments,
        # thumbnails). Mode + size preserved so PNG / WebP alpha survives.
        cleaned = Image.frombytes(source.mode, source.size, source.tobytes())

        output = BytesIO()
        if content_type == "image/jpeg":
            # JPEG can't hold transparency; convert RGBA→RGB if the
            # source had alpha (real uploads are usually RGB anyway).
            save_target = cleaned
            if save_target.mode not in {"RGB", "L"}:
                save_target = cleaned.convert("RGB")
            save_target.save(
                output,
                format="JPEG",
                quality=95,
                subsampling=0,
                optimize=True,
                progressive=False,
            )
        elif content_type == "image/png":
            cleaned.save(output, format="PNG", optimize=True)
        else:  # image/webp
            cleaned.save(output, format="WEBP", quality=95, method=6)
        return output.getvalue()


# Display-derivative dimensions. Hero = detail-page render (full-width in a
# max-w-4xl column ≈ 1280 px after the sidebar offset); thumbnail = map popup
# / search card / form preview (~200–300 px CSS, doubled for 2x-DPI). Phone
# uploads are routinely 4032×3024, so a 1280 max-dim cuts the pixel count ~6×
# for a wash on visible quality.
#
# Quality 80 is the Twitter / X / Mastodon default — indistinguishable from 95
# at these dimensions, 3–4× smaller payload. Originals (full-res,
# EXIF-stripped) are the evidence path; derivatives are the display path.
HERO_MAX_DIM = 1280
THUMBNAIL_MAX_DIM = 400
DERIVATIVE_JPEG_QUALITY = 80

# What :func:`make_jpeg_derivative` emits, whatever the source was, and what the
# PUT that stores a derivative declares. Machine-imported photos are re-encoded
# to this same type at ingest (``tweet_ingest.records.PHOTO_CONTENT_TYPE``), so
# a detection's original and its derivatives read as one format everywhere.
DERIVATIVE_CONTENT_TYPE = "image/jpeg"


def make_jpeg_derivative(data: bytes, content_type: str, max_dim: int) -> bytes:
    """Resize ``data`` so the longer edge fits ``max_dim`` and encode as JPEG.

    Returns the encoded JPEG bytes. Caller owns the S3 key naming
    (``..._hero.jpg`` / ``..._thumb.jpg``) and the
    ``Content-Type: image/jpeg`` on the PUT — pure CPU-bound transform, no
    I/O.

    Always JPEG regardless of source. PNG / WebP alpha is discarded
    (``convert("RGB")``), so semi-transparent regions render on the JPEG
    decoder's default background (black, not white). The originals stay
    around for the rare transparent-PNG case; forcing JPEG lets the frontend
    assume ``_hero.jpg`` / ``_thumb.jpg`` everywhere.

    Aspect ratio preserved (longer edge → ``max_dim``).
    ``Image.Resampling.LANCZOS`` is Pillow's sharpest filter; its CPU cost
    is dwarfed by the JPEG encode.

    ``ImageOps.exif_transpose`` runs before resize so an EXIF Orientation
    tag (5–8) is baked into pixel orientation. It matters on the paths that
    reach here without a strip: the seed-pool prep pass calls this on raw
    pool bytes, and without exif_transpose the derivative would render
    rotated relative to the original served at the public URL (browsers
    honour Orientation on the raw JPEG). On stripped bytes it finds nothing
    to do, since ``strip_metadata`` already applied the tag.

    Same hardening as ``strip_metadata`` (kept here so the helper is safe
    standalone): decompression-bomb check before ``img.load()``; animated
    images rejected; palette modes converted before resize.

    No-op for non-image content types, matching ``strip_metadata``.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    with (
        _decode_errors(
            f"make_jpeg_derivative (content_type={content_type}, "
            f"max_dim={max_dim}, {len(data)} bytes)",
            undecodable=f"Could not decode {content_type} for derivative resize",
        ),
        _guarded_open(data) as opened,
    ):
        # ``_guarded_open`` hands back palette-with-alpha as RGBA (not RGB),
        # which matters here even though the encode discards alpha:
        # ``thumbnail`` with LANCZOS in RGBA gives alpha-aware antialiasing at
        # transparent/opaque edges. Downscaling in RGB blends garbage
        # RGB-under-transparent-pixels into the edges (black bleeding on
        # logo-shaped images). The trailing ``convert("RGB")`` drops alpha
        # *after* the downscale.
        #
        # Honour EXIF Orientation before resize, see the docstring's
        # exif_transpose paragraph. No-op when the source carries no
        # Orientation tag (e.g. post-strip bytes).
        source = ImageOps.exif_transpose(opened)

        # ``thumbnail`` won't upscale a source already smaller on both edges,
        # but still JPEG-recompresses at the lower quality: intended, so
        # bytes-on-the-wire are consistent regardless of source size.
        source.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        # JPEG can't hold transparency, so ``convert("RGB")`` discards alpha
        # (Pillow does NOT composite onto a background; pixels under
        # transparency render at whatever the RGB triple was).
        if source.mode not in {"RGB", "L"}:
            source = source.convert("RGB")

        output = BytesIO()
        source.save(
            output,
            format="JPEG",
            quality=DERIVATIVE_JPEG_QUALITY,
            optimize=True,
            progressive=False,
        )
        return output.getvalue()
