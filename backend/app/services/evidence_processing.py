"""Pre-storage transforms applied to uploaded evidence files.

Today this module hosts exactly one transform: ``strip_metadata`` for
image uploads, which drops EXIF, GPS coordinates, camera-make / model,
IPTC tags, and embedded thumbnails before the bytes reach S3. The
analyst persona is OSINT / GEOINT-adjacent, and phone-shot JPEGs
commonly carry the *submitter's own* GPS in their EXIF — shipping that
raw to every viewer via CloudFront would directly compromise the
analyst's safety. The strip is non-negotiable for any new upload.

The sha256 captured by ``services/storage.py`` runs **after** the strip
(on the bytes that physically land on S3), so the on-disk fingerprint
matches what an auditor can independently recompute by downloading the
public URL.

Pillow's ``save()`` deliberately drops metadata unless asked to keep
it — that's the contract we lean on, and a round-trip-encode is the
only way to guarantee EXIF + ICC + XMP + IPTC are all gone (snipping
the EXIF marker alone leaves GPS in IFD0, IPTC in APP13, etc).
The tradeoff is one JPEG recompression pass; we pin
``quality=95, subsampling=0`` so the loss is visually negligible.

This module is **synchronous and CPU-bound** — call it via
``asyncio.to_thread`` from the upload helper so the uvicorn event
loop stays free during the libjpeg / libwebp encode (WebP method=6
on a 4000×4000 image is multi-second on commodity hardware).
"""

from __future__ import annotations

import logging
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)


# Content types whose metadata we know how to strip cleanly. Mirrors
# ``ALLOWED_IMAGE_TYPES`` in ``services/storage.py`` — kept as its own
# constant rather than imported because the storage module isn't a
# natural home for the EXIF strip contract.
_STRIPPABLE_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# Hard cap on decoded image dimensions. A "decompression bomb" is a
# small file (e.g. 2 MB JPEG) that decodes to a huge raster (12000 ×
# 12000 ≈ 580 MB RGB / 770 MB RGBA), enough to OOM the single
# Railway worker from one attacker request. Pillow exposes
# ``Image.MAX_IMAGE_PIXELS`` for this but its default (89 478 485 px)
# only emits a *warning* at the cap and only raises past 2× the cap,
# which is too loose for a public endpoint. We check the lazy
# ``Image.open(...).size`` (header parse, no decode) and refuse
# anything above our own ceiling before ``img.load()`` allocates the
# pixel buffer.
#
# 60 MP is comfortably above any real phone / DSLR upload (current
# top-of-line is ~50 MP); honest 100 MP astrophotography is rare
# enough that surfacing a clean 400 is acceptable. Raw RGBA storage
# for 60 MP is ≈ 240 MB, which the worker can hold without thrashing.
MAX_DECODED_PIXELS = 60_000_000

# NOTE: we deliberately do NOT mutate ``Image.MAX_IMAGE_PIXELS``. An
# earlier iteration set it to ``MAX_DECODED_PIXELS`` (either at module
# import or via try/finally inside ``strip_metadata``) as a
# defence-in-depth belt around the explicit ``Image.open(...).size``
# check below. Both approaches are wrong:
#
# * Module-level set leaks the cap onto every other Pillow consumer
#   in the process (admin OG-image routes, future thumbnail
#   generators) — spooky-action-at-a-distance.
# * Function-scoped set/restore races between concurrent strip calls
#   in the ``asyncio.to_thread`` pool: thread B may capture a
#   thread-A-narrowed value as its "original" and restore to it
#   permanently.
#
# The explicit ``width * height > MAX_DECODED_PIXELS`` check on the
# lazy ``Image.open(...).size`` is race-free (it operates on locals)
# and fires *before* any pixel-buffer allocation, so the Pillow
# global cap is genuinely redundant.


class EvidenceProcessingError(ValueError):
    """Raised when an image upload can't be metadata-stripped.

    A ``ValueError`` subclass so the router's existing
    ``ValueError`` → 400 handler picks it up without bespoke wiring.
    """


def strip_metadata(data: bytes, content_type: str) -> bytes:
    """Return the bytes of ``data`` with all metadata stripped.

    For non-image content types (videos) the input is returned
    unchanged — the strip only applies to JPEG / PNG / WebP. For
    images, the file is decoded, re-encoded without metadata, and the
    new bytes are returned. The encoder parameters preserve visible
    quality:

    * **JPEG** — ``quality=95, subsampling=0`` (4:4:4 chroma so place-
      name signage stays sharp), ``optimize=True`` (Huffman tables
      tuned per-image). ``progressive=False`` for predictable size on
      small thumbnails.
    * **PNG** — ``optimize=True``; PNG is lossless so EXIF strip is
      effectively free of pixel-level cost.
    * **WebP** — ``quality=95, method=6`` (slowest encoder, best
      compression / quality tradeoff).

    Rejects (raises ``EvidenceProcessingError`` → router 400):

    * **Corrupt / truncated** images (Pillow can't decode the header).
    * **Decompression bombs** — dimensions above
      ``MAX_DECODED_PIXELS``, before we allocate the pixel buffer.
    * **Animated** images (multi-frame GIF / APNG / animated WebP) —
      ``frombytes`` would silently flatten to a single frame and an
      analyst submitting a clip-as-image would lose evidence; surface
      the rejection so they re-upload as a video.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        # Videos and any future non-image type pass through untouched.
        # Adding video-side strip-equivalent work (probe streams,
        # strip metadata atoms) is a separate slice — see next.md.
        return data

    try:
        # Use a fresh BytesIO so ``img.load()`` can fully detach from
        # the buffer; otherwise PIL holds a reference to the source
        # bytes for lazy decoding and the source has to stay alive.
        with Image.open(BytesIO(data)) as img:
            # ``Image.open`` is lazy — it parses the header but does
            # NOT decode the pixel buffer. So ``img.size`` is cheap
            # and the bomb check fires *before* the load() call below
            # would allocate 100s of MB.
            width, height = img.size
            pixels = width * height
            if pixels > MAX_DECODED_PIXELS:
                raise EvidenceProcessingError(
                    f"Image dimensions {width}x{height} ({pixels} px) "
                    f"exceed the {MAX_DECODED_PIXELS} pixel cap"
                )

            # Reject animated multi-frame images. ``is_animated`` is
            # only set on formats that can be animated (GIF / APNG /
            # animated WebP); ``getattr`` covers single-frame inputs
            # where the attribute is absent.
            if getattr(img, "is_animated", False):
                raise EvidenceProcessingError(
                    "Animated images are not supported — upload as a video instead"
                )

            img.load()

            # Palette-mode images (``P``, ``PA``) store pixel data as
            # indexes into ``img.palette``; ``img.tobytes()`` returns
            # the *indexes*, not the resolved RGB triples, and
            # ``frombytes`` without the palette would render the
            # rebuilt image as black / garbage. Convert to a full
            # colour mode first.
            #
            # Use ``img.has_transparency_data`` rather than
            # ``"transparency" in img.info`` — the latter only catches
            # the palette+tRNS case and would miss ``mode == "PA"``
            # (palette + alpha plane), silently flattening alpha to
            # opaque. ``has_transparency_data`` is the Pillow-canonical
            # check and reports True across RGBA / tRNS / PA / etc.
            #
            # ``source`` is a fresh local — ``img`` stays typed as
            # ``ImageFile`` for the ``with`` block's __exit__, and we
            # build the rebuilt image off ``source`` instead.
            source: Image.Image
            if img.mode in {"P", "PA"}:
                target_mode = "RGBA" if img.has_transparency_data else "RGB"
                source = img.convert(target_mode)
            else:
                source = img

            # Rebuild from raw pixel bytes only — drops the entire
            # ``img.info`` dict (EXIF, IPTC, XMP, ICC profile, JFIF,
            # comments, thumbnails). Mode + size preserved so PNG /
            # WebP alpha survives.
            cleaned = Image.frombytes(source.mode, source.size, source.tobytes())

            output = BytesIO()
            if content_type == "image/jpeg":
                # JPEG can't hold transparency; convert RGBA→RGB on a
                # white background if the source had alpha. (Real
                # uploads are usually RGB anyway, but belt + braces.)
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
    except EvidenceProcessingError:
        # Already shaped for the router. Don't re-wrap — the outer
        # ``except (UnidentifiedImageError, OSError)`` would otherwise
        # log "cannot decode" for what was actually a bomb / animation
        # rejection.
        raise
    except Image.DecompressionBombError as exc:
        # Pillow's *default* tripwire fired (89 MP, the library
        # default — we deliberately don't override it). Catching this
        # keeps a stray malformed image from 500ing the endpoint even
        # though our explicit size check above should fire first.
        logger.warning(
            "strip_metadata: Pillow DecompressionBombError (content_type=%s, %d bytes): %s",
            content_type,
            len(data),
            exc,
        )
        raise EvidenceProcessingError("Image rejected as a decompression bomb") from exc
    except (UnidentifiedImageError, OSError) as exc:
        # Corrupt / truncated / format-mismatched image. Log so the
        # admin can see the rate of these in Sentry but raise a clean
        # ValueError so the router emits 400 instead of 500.
        logger.warning(
            "strip_metadata: cannot decode image (content_type=%s, %d bytes): %s",
            content_type,
            len(data),
            exc,
        )
        raise EvidenceProcessingError(
            f"Could not decode {content_type} for metadata stripping"
        ) from exc


# Display-derivative dimensions. The hero is the detail-page render
# (full-width inside a max-w-4xl column on desktop ≈ 1280 px after the
# sidebar offset); the thumbnail is the map popup / search card / form
# preview (~200–300 px in CSS, doubled for 2x-DPI screens). Bumping
# either dimension trades bandwidth for a wash on visible quality at
# the current render targets — phone uploads are routinely 4032×3024
# (Pixel) or 3000×4000 (iPhone), so a 1280 max-dim cuts the pixel
# count by ~6×.
#
# Quality 80 is the Twitter / X / Mastodon default — visually
# indistinguishable from 95 at the target dimensions, but the
# encoded payload is 3–4× smaller. Combined, the hero JPEG lands
# around 200–600 KB (varies with subject complexity) and the
# thumbnail around 25–80 KB. Originals (full-res, EXIF-stripped) are
# preserved unchanged for forensic auditing — derivatives are the
# *display* path, not the evidence path.
HERO_MAX_DIM = 1280
THUMBNAIL_MAX_DIM = 400
DERIVATIVE_JPEG_QUALITY = 80


def make_jpeg_derivative(data: bytes, content_type: str, max_dim: int) -> bytes:
    """Resize ``data`` so the longer edge fits ``max_dim`` and encode as JPEG.

    Returns the encoded JPEG bytes. Caller is responsible for the S3
    key naming convention (``..._hero.jpg`` / ``..._thumb.jpg``) and
    for the ``Content-Type: image/jpeg`` on the PUT — this helper is
    pure CPU-bound transform, no I/O.

    Always produces a JPEG regardless of source format. PNG / WebP
    sources have any alpha channel discarded (``convert("RGB")``
    drops alpha — same JPEG-encode endpoint as ``strip_metadata``) so
    semi-transparent regions render on whatever the JPEG decoder's
    default background is (typically black, not the white the earlier
    comment claimed — fixed). Derivatives are the display path and
    the originals stay around for the rare transparent-PNG case.
    Skipping format-preservation cuts a class of branches we'd
    otherwise carry through the frontend renderer too (it can assume
    ``_hero.jpg`` / ``_thumb.jpg`` everywhere).

    Aspect ratio is preserved: the longer edge becomes ``max_dim`` and
    the shorter edge scales proportionally. ``Image.Resampling.LANCZOS`` is the
    sharpest of Pillow's resampling filters and what every other
    image-pipeline reaches for; CPU cost is dwarfed by the
    JPEG-encode pass anyway.

    ``ImageOps.exif_transpose`` runs before resize so any EXIF
    Orientation tag (5–8: 90° / 180° / 270° / mirrored) is baked
    into pixel orientation in the derivative. The regular upload
    path runs ``strip_metadata`` first which discards EXIF, so the
    derivative would otherwise render upright while the original
    rendered rotated (browsers honour Orientation on the raw JPEG).
    The seed-pool prep pass skips ``strip_metadata`` entirely and
    calls this helper on raw pool bytes — without ``exif_transpose``
    the derivative would render rotated relative to the original
    served by the public URL.

    Same hardening as ``strip_metadata``:

    * Decompression-bomb check on the lazy ``Image.open(...).size``
      *before* ``img.load()`` allocates pixels.
    * Animated images are rejected — they should never reach this
      function (the strip layer already rejects them) but the
      explicit check keeps this helper safe to call standalone (e.g.
      from the seed-pool pre-processing pass).
    * Palette modes converted to RGB / RGBA before resize so Pillow
      doesn't render the palette indexes as pixels.

    No-op for non-image content types: callers (videos, audio) get
    the input back unchanged. Matches ``strip_metadata`` so the two
    helpers compose cleanly in the storage layer.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    try:
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
                    "Animated images are not supported — upload as a video instead"
                )

            img.load()

            source: Image.Image
            if img.mode in {"P", "PA"}:
                # Convert palette-with-alpha to RGBA (not RGB) before
                # the resize even though the final encode discards
                # alpha: ``Image.thumbnail`` with LANCZOS samples in
                # RGBA mode gives alpha-aware antialiasing at the
                # edges between transparent and opaque regions.
                # Converting to RGB first would blend
                # RGB-under-transparent-pixels (often garbage /
                # 0,0,0) into the visible edges and produce black
                # bleeding on logo-shaped images. The trailing
                # ``convert("RGB")`` below discards the alpha plane
                # *after* the high-quality downscale is done.
                target_mode = "RGBA" if img.has_transparency_data else "RGB"
                source = img.convert(target_mode)
            else:
                source = img

            # Honour EXIF Orientation before resize — see docstring
            # ``exif_transpose`` paragraph for the rotated-derivative
            # vs rotated-original failure mode this guards against.
            # No-op when the source carries no Orientation tag (e.g.
            # post-``strip_metadata`` bytes from the regular upload
            # path), so this is free for the dominant case.
            source = ImageOps.exif_transpose(source)

            # If the image is already smaller than the target dim on
            # both edges, ``thumbnail`` is a no-op — Pillow refuses to
            # upscale. The encoded output is still JPEG-recompressed
            # at the lower quality, which is the intended behaviour:
            # an already-small source still gets the display-path
            # encoder pass so the bytes-on-the-wire are consistent
            # regardless of source dimensions.
            source.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            # JPEG can't hold transparency — ``convert("RGB")``
            # discards the alpha plane (Pillow does NOT composite onto
            # any background; pixels under transparency render at
            # whatever the encoded RGB triple happened to be). The
            # original PNG/WebP stays around for the transparent case.
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
    except EvidenceProcessingError:
        raise
    except Image.DecompressionBombError as exc:
        logger.warning(
            "make_jpeg_derivative: Pillow DecompressionBombError "
            "(content_type=%s, max_dim=%d, %d bytes): %s",
            content_type,
            max_dim,
            len(data),
            exc,
        )
        raise EvidenceProcessingError("Image rejected as a decompression bomb") from exc
    except (UnidentifiedImageError, OSError) as exc:
        logger.warning(
            "make_jpeg_derivative: cannot decode image (content_type=%s, max_dim=%d, %d bytes): %s",
            content_type,
            max_dim,
            len(data),
            exc,
        )
        raise EvidenceProcessingError(
            f"Could not decode {content_type} for derivative resize"
        ) from exc
