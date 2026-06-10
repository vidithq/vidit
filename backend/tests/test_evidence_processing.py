"""Tests for the pre-storage metadata strip.

The strip pass is the platform's defence against accidentally leaking
the submitter's own GPS coordinates (or other personally-identifying
EXIF / IPTC / XMP metadata) every time they upload a phone-shot
JPEG. These tests lock in the contract:

* JPEG with EXIF in → bytes with no EXIF marker out.
* Corrupt image in → ``EvidenceProcessingError`` (router 400, no
  half-written S3 object).
* Non-image content type (video) → bytes unchanged (no Pillow on the
  hot path for the 100 MB upload ceiling).
* The output is still a valid, decodable image at the same dimensions
  and mode.
"""

from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from app.services.evidence_processing import (
    HERO_MAX_DIM,
    MAX_DECODED_PIXELS,
    THUMBNAIL_MAX_DIM,
    EvidenceProcessingError,
    make_jpeg_derivative,
    strip_metadata,
)


def _jpeg_with_exif() -> bytes:
    """A real 4×4 JPEG with a populated EXIF block.

    ``exif=<bytes>`` writes the literal block into the APP1 segment,
    so the output carries the ``Exif\\x00\\x00`` marker that our
    strip must remove. The minimal block here mimics a GPS-stamped
    phone photo without depending on piexif.
    """
    img = Image.new("RGB", (4, 4), "blue")
    buf = BytesIO()
    # Tiny but well-formed EXIF block — a single IFD0 entry. The exact
    # content doesn't matter; what matters is the "Exif" magic ends up
    # in the JPEG bytes for the test to detect.
    exif = (
        b"Exif\x00\x00"  # APP1 EXIF magic
        b"II*\x00"  # little-endian TIFF header
        b"\x08\x00\x00\x00"  # offset to first IFD
        b"\x01\x00"  # one IFD entry
        b"\x12\x01"  # tag (orientation)
        b"\x03\x00"  # type (SHORT)
        b"\x01\x00\x00\x00"  # count = 1
        b"\x01\x00\x00\x00"  # value
        b"\x00\x00\x00\x00"  # next IFD offset (none)
    )
    img.save(buf, format="JPEG", quality=85, exif=exif)
    return buf.getvalue()


def test_strip_metadata_removes_exif_from_jpeg():
    raw = _jpeg_with_exif()
    assert b"Exif" in raw, "test fixture sanity — input must carry EXIF"
    # Semantic check on the input: Pillow can parse the EXIF block.
    assert dict(Image.open(BytesIO(raw)).getexif()), (
        "test fixture sanity — input EXIF must be parseable by Pillow"
    )

    cleaned = strip_metadata(raw, "image/jpeg")

    # Substring belt: literal ``Exif`` marker is gone.
    assert b"Exif" not in cleaned, "EXIF marker survived strip"
    # Semantic braces: the actual EXIF dict via getexif() is empty
    # (this is the load-bearing assertion — a hostile fixture could
    # carry EXIF without the literal "Exif" magic, but it couldn't
    # produce a non-empty ``getexif()`` dict).
    out = Image.open(BytesIO(cleaned))
    out.load()
    assert dict(out.getexif()) == {}, "EXIF dict survived strip"
    assert cleaned != raw, "strip produced identical bytes — re-encode didn't run"
    assert out.format == "JPEG"
    assert out.size == (4, 4)


def test_strip_metadata_removes_icc_profile_and_xmp():
    """Module docstring claims ICC profile + XMP are stripped — lock
    that contract in. ``frombytes`` re-build drops ``img.info`` which
    is where Pillow surfaces both, so this is a regression guard
    against someone "optimising" the strip back to a copy-with-info
    approach.
    """
    # Build a JPEG carrying an ICC profile + an XMP-shaped block. The
    # exact ICC body is bytes (we just need *something* in the slot);
    # XMP is XML-shaped APP1 data after a "http://ns.adobe.com/xap/1.0/\0"
    # signature.
    img = Image.new("RGB", (4, 4), "green")
    buf = BytesIO()
    icc = b"\x00\x00\x02\x18ADBE\x02\x10\x00\x00mntrRGB" + b"\x00" * 64
    xmp = (
        b"http://ns.adobe.com/xap/1.0/\x00"
        b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>'
        b'<?xpacket end="r"?>'
    )
    img.save(buf, format="JPEG", quality=85, icc_profile=icc, xmp=xmp)
    raw = buf.getvalue()
    assert Image.open(BytesIO(raw)).info.get("icc_profile"), "ICC profile not in fixture"

    cleaned = strip_metadata(raw, "image/jpeg")

    out = Image.open(BytesIO(cleaned))
    out.load()
    assert "icc_profile" not in out.info, "ICC profile survived strip"
    # XMP lands in ``info["XML:com.adobe.xmp"]`` (or similar) when
    # Pillow can parse it; either way the key shouldn't be present.
    assert not any(k.lower().startswith("xml") for k in out.info), (
        f"XMP-shaped key survived strip: {out.info.keys()}"
    )


def test_strip_metadata_passes_through_video_bytes():
    # Video content type → no Pillow path, identical bytes back.
    # The bytes don't have to be a real video; the contract is
    # "non-image content type, no transform attempted".
    payload = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    result = strip_metadata(payload, "video/mp4")
    assert result == payload


def test_strip_metadata_raises_on_corrupt_image():
    """A 4-byte JPEG stub (SOI + EOI only) isn't decodable.

    Pillow's ``UnidentifiedImageError`` / ``OSError`` must surface as
    ``EvidenceProcessingError`` so the router's ``ValueError`` → 400 path picks
    it up before any storage write.
    """
    with pytest.raises(EvidenceProcessingError, match="decode"):
        strip_metadata(b"\xff\xd8\xff\xd9", "image/jpeg")


def test_strip_metadata_unknown_content_type_passes_through():
    """Defensive: unknown / unset content_type → no-op pass-through.

    Belt + braces — the router validates content type before this is
    called, but the helper should still no-op rather than 500 on a
    surprise input.
    """
    payload = b"arbitrary"
    assert strip_metadata(payload, "application/octet-stream") == payload
    assert strip_metadata(payload, "") == payload


def test_strip_metadata_rejects_decompression_bomb(monkeypatch):
    """A small file declaring oversized dimensions must 400 before
    Pillow allocates the (multi-GB) pixel buffer.

    The explicit ``width * height > MAX_DECODED_PIXELS`` check on the
    lazy ``Image.open(...).size`` is the load-bearing defence —
    operates on locals (race-free) and fires before any pixel-buffer
    allocation. Pillow's own ``DecompressionBombError`` is still
    handled by the ``except`` clause as a safety net for inputs that
    declare a small size in the header but ship oversized data past
    Pillow's 89 MP default, but we do NOT narrow Pillow's global cap
    here (would race between concurrent ``asyncio.to_thread`` calls).

    The regex below accepts either error wording so a future
    refactor of the message strings doesn't break the test.
    """
    from app.services import evidence_processing as ep

    # Build a 4×4 JPEG normally.
    img = Image.new("RGB", (4, 4), "white")
    buf = BytesIO()
    img.save(buf, format="JPEG")

    monkeypatch.setattr(ep, "MAX_DECODED_PIXELS", 4)  # 3×3+ trips it
    with pytest.raises(EvidenceProcessingError, match="(pixel cap|decompression bomb)"):
        ep.strip_metadata(buf.getvalue(), "image/jpeg")

    # Sanity: with the cap restored by monkeypatch's teardown, the
    # same image should strip fine again. (Run as a separate
    # ``monkeypatch.undo()`` here so the assertion sees the original
    # value within the test body.)
    monkeypatch.undo()
    assert ep.strip_metadata(buf.getvalue(), "image/jpeg")


def test_strip_metadata_preserves_palette_png_colours():
    """A palette-mode PNG must come back as a real-colour image, not
    rebuilt as black/garbage.

    The PR-review-reproduced bug: ``Image.frombytes(img.mode,
    img.size, img.tobytes())`` on a ``mode == "P"`` image rebuilt the
    bytes but lost the palette, so pixel index `15` got read as RGB
    `(0, 0, 0)`. We assert the output is decodable AND the pixel
    colour at (0,0) is close to the original blue (Pillow's PNG /
    palette quantisation isn't exact-equal, but it shouldn't be black).
    """
    img = Image.new("RGB", (4, 4), (15, 50, 200)).convert("P", palette=Image.Palette.ADAPTIVE)
    buf = BytesIO()
    img.save(buf, format="PNG")

    cleaned = strip_metadata(buf.getvalue(), "image/png")
    out = Image.open(BytesIO(cleaned))
    out.load()

    # Should be RGB/RGBA, not palette (we converted away from P).
    assert out.mode in {"RGB", "RGBA"}
    pixel = out.getpixel((0, 0))
    # Allow for palette / JPEG-like roundtrip drift but the blue channel
    # must dominate; if the bug regresses, all channels would be 0.
    assert pixel[2] > 100, f"palette PNG lost colour during strip — got {pixel}"


def test_strip_metadata_preserves_palette_png_transparency():
    """A palette PNG with a ``tRNS`` chunk (per-index alpha) must come
    back as RGBA with alpha intact — not silently flattened to opaque
    RGB.

    Earlier check was ``"transparency" in img.info`` which works for
    the palette+tRNS case but misses ``mode == "PA"`` (palette +
    alpha plane). The fix uses ``has_transparency_data`` which covers
    both; this test guards specifically the tRNS path.
    """
    # Build a palette PNG with one fully-transparent and one opaque
    # entry. The tRNS bytes table corresponds to palette indexes.
    img = Image.new("P", (4, 4))
    img.putpalette([255, 0, 0, 0, 0, 255], "RGB")  # idx 0 red, idx 1 blue
    img.info["transparency"] = bytes([0, 255])  # idx 0 transparent, idx 1 opaque
    # Make the corner pixel use the transparent index.
    img.putpixel((0, 0), 0)
    img.putpixel((3, 3), 1)
    buf = BytesIO()
    img.save(buf, format="PNG")

    cleaned = strip_metadata(buf.getvalue(), "image/png")
    out = Image.open(BytesIO(cleaned))
    out.load()

    # The output must be RGBA — RGB would mean alpha was discarded.
    assert out.mode == "RGBA", f"palette tRNS lost alpha — got mode={out.mode}"
    # Transparent corner stays transparent.
    assert out.getpixel((0, 0))[3] < 64, (
        f"transparent palette pixel rebuilt as opaque — got alpha={out.getpixel((0, 0))[3]}"
    )


def test_strip_metadata_rejects_animated_webp():
    """Animated WebP / APNG silently flattened to one frame is worse
    than rejection — the analyst thinks their footage uploaded but
    only the first frame survives. Surface a clean error so they can
    re-upload as a video.
    """
    frames = [Image.new("RGB", (4, 4), c) for c in ("red", "green", "blue")]
    buf = BytesIO()
    frames[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=100,
        loop=0,
    )

    with pytest.raises(EvidenceProcessingError, match="Animated"):
        strip_metadata(buf.getvalue(), "image/webp")


def test_max_decoded_pixels_at_or_above_60mp():
    """Guard against an accidental tightening below realistic phone /
    DSLR uploads. Top-of-line phone cameras shoot ~50 MP today;
    100 MP astrophotography is rare enough to safely reject.
    """
    assert MAX_DECODED_PIXELS >= 50_000_000


# ── make_jpeg_derivative ─────────────────────────────────────────────────


def _solid_jpeg(width: int, height: int) -> bytes:
    """A real JPEG of the requested dimensions. Used to verify the
    resize+encode path produces decodable output and clamps to the
    target ``max_dim``.
    """
    img = Image.new("RGB", (width, height), "red")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_make_jpeg_derivative_clamps_longer_edge_to_max_dim():
    """The output's longer edge must equal ``max_dim`` exactly when the
    input is larger. Aspect ratio preserved on the shorter edge.
    """
    raw = _solid_jpeg(3200, 1600)  # 2:1 landscape
    out = make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert max(decoded.size) == HERO_MAX_DIM, decoded.size
    # 2:1 aspect preserved.
    assert decoded.size == (HERO_MAX_DIM, HERO_MAX_DIM // 2)
    # JPEG output regardless of source format choices.
    assert decoded.format == "JPEG"


def test_make_jpeg_derivative_does_not_upscale_smaller_images():
    """``Image.thumbnail`` refuses to upscale — that's the intended
    behaviour. A 200×100 source through the 400-max thumb path lands
    back at 200×100, not upscaled to 400×200. Saves bandwidth on
    already-tiny inputs without producing a visibly soft upscale.
    """
    raw = _solid_jpeg(200, 100)
    out = make_jpeg_derivative(raw, "image/jpeg", THUMBNAIL_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert decoded.size == (200, 100)


def test_make_jpeg_derivative_always_outputs_jpeg_for_png_input():
    """PNG sources must be re-encoded as JPEG — the convention is that
    every derivative ends in ``.jpg`` regardless of source format so
    the frontend's structural-naming derivation is unambiguous.
    """
    img = Image.new("RGBA", (800, 600), (255, 0, 0, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    out = make_jpeg_derivative(raw, "image/png", THUMBNAIL_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert decoded.format == "JPEG"
    # Alpha flattened to RGB (JPEG can't carry transparency).
    assert decoded.mode == "RGB"


def test_make_jpeg_derivative_returns_video_bytes_unchanged():
    """Mirrors ``strip_metadata`` — videos pass through unchanged so
    the helper composes cleanly in the storage layer where the
    upload path branches on content type only once.
    """
    payload = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"  # MP4 header signature, not parsed
    out = make_jpeg_derivative(payload, "video/mp4", HERO_MAX_DIM)
    assert out is payload


def test_make_jpeg_derivative_rejects_corrupt_image():
    """A corrupt input should surface as ``EvidenceProcessingError``
    (router → 400) rather than a 500 from an uncaught Pillow exception.
    Matches ``strip_metadata``'s contract.
    """
    with pytest.raises(EvidenceProcessingError, match="Could not decode"):
        make_jpeg_derivative(b"not-a-jpeg", "image/jpeg", HERO_MAX_DIM)


def test_make_jpeg_derivative_rejects_decompression_bomb(monkeypatch):
    """``max_dim`` doesn't override the bomb cap — header-parse
    dimensions above ``MAX_DECODED_PIXELS`` are still refused before
    any pixel-buffer allocation. Lowering the cap via monkeypatch
    keeps the test fixture small while still exercising the branch.
    """
    monkeypatch.setattr("app.services.evidence_processing.MAX_DECODED_PIXELS", 2500)
    raw = _solid_jpeg(100, 100)  # 10_000 pixels — above the patched cap
    with pytest.raises(EvidenceProcessingError, match="pixel cap"):
        make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)


def test_hero_is_larger_than_thumbnail():
    """Sanity-check the constants relate the way callers assume —
    swapping them would silently invert the bandwidth budget across
    every render surface in the app.
    """
    assert HERO_MAX_DIM > THUMBNAIL_MAX_DIM


def test_make_jpeg_derivative_bakes_in_exif_orientation():
    """A source JPEG carrying EXIF Orientation 6 (rotate 270° CW for
    display) must be transposed before resize so the derivative pixel
    orientation matches what a browser would render from the EXIF-
    bearing original. Without ``exif_transpose``, the derivative would
    render upright while the original (still EXIF-stamped on its
    raw-bytes public URL) renders rotated — visible mismatch in any
    surface that shows both, and specifically broken on the
    demo-seed-pool path which skips ``strip_metadata`` entirely.
    """
    # Build a 200×100 (landscape) JPEG, then write an EXIF block with
    # Orientation = 6 (rotate 270° CW for display). A browser
    # honouring EXIF would render it as 100×200 (portrait); after
    # ``exif_transpose`` the pixel array itself is 100×200.
    img = Image.new("RGB", (200, 100), "blue")
    buf = BytesIO()
    exif = (
        b"Exif\x00\x00"
        b"II*\x00"
        b"\x08\x00\x00\x00"
        b"\x01\x00"
        b"\x12\x01"  # tag 0x0112 = Orientation
        b"\x03\x00"  # type SHORT
        b"\x01\x00\x00\x00"  # count 1
        b"\x06\x00\x00\x00"  # value 6 (rotate 270° CW)
        b"\x00\x00\x00\x00"
    )
    img.save(buf, format="JPEG", quality=95, exif=exif)
    raw = buf.getvalue()

    # The source as a Pillow image (without exif_transpose) is 200×100.
    assert Image.open(BytesIO(raw)).size == (200, 100)

    out = make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    # After transpose the *pixel* dimensions are swapped; the longer
    # edge is still ≤ HERO_MAX_DIM (no upscaling on small inputs).
    assert decoded.size == (100, 200), (
        f"EXIF Orientation 6 not baked into derivative — got {decoded.size}, expected (100, 200)"
    )
