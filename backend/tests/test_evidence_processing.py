"""Pre-storage metadata strip: no EXIF/IPTC/XMP out, corrupt or non-JPEG/PNG/WebP in raises
``EvidenceProcessingError``, video passes through unchanged, output stays a decodable image."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from PIL import Image, ImageFile, PngImagePlugin

from app.services.evidence_processing import (
    _ACCEPTED_FORMATS,
    HERO_MAX_DIM,
    MAX_CONCURRENT_DECODES,
    MAX_DECODED_PIXELS,
    THUMBNAIL_MAX_DIM,
    UNREADABLE_IMAGE_MESSAGE,
    EvidenceProcessingError,
    make_jpeg_derivative,
    strip_metadata,
)
from app.services.storage import ALLOWED_IMAGE_TYPES


def _jpeg_with_exif() -> bytes:
    """A real 4x4 JPEG with a populated EXIF block (a GPS-stamped phone photo stand-in)."""
    img = Image.new("RGB", (4, 4), "blue")
    buf = BytesIO()
    # Minimal well-formed EXIF block, a single IFD0 entry; only the "Exif" magic matters.
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
    assert dict(Image.open(BytesIO(raw)).getexif()), (
        "test fixture sanity — input EXIF must be parseable by Pillow"
    )

    cleaned = strip_metadata(raw, "image/jpeg")

    assert b"Exif" not in cleaned, "EXIF marker survived strip"
    # The load-bearing check: a hostile fixture could carry EXIF without the literal magic,
    # but not a non-empty getexif().
    out = Image.open(BytesIO(cleaned))
    out.load()
    assert dict(out.getexif()) == {}, "EXIF dict survived strip"
    assert cleaned != raw, "strip produced identical bytes — re-encode didn't run"
    assert out.format == "JPEG"
    assert out.size == (4, 4)


def test_strip_metadata_removes_icc_profile_xmp_and_comment():
    """ICC profile, XMP and the JPEG comment (copied from ``img.info`` unless the strip empties it) are stripped."""
    # A JPEG carrying an ICC profile and an XMP-shaped APP1 block.
    img = Image.new("RGB", (4, 4), "green")
    buf = BytesIO()
    icc = b"\x00\x00\x02\x18ADBE\x02\x10\x00\x00mntrRGB" + b"\x00" * 64
    xmp = (
        b"http://ns.adobe.com/xap/1.0/\x00"
        b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>'
        b'<?xpacket end="r"?>'
    )
    img.save(buf, format="JPEG", quality=85, icc_profile=icc, xmp=xmp, comment=b"home address")
    raw = buf.getvalue()
    assert Image.open(BytesIO(raw)).info.get("icc_profile"), "ICC profile not in fixture"
    assert b"home address" in raw, "comment not in fixture"

    cleaned = strip_metadata(raw, "image/jpeg")

    assert b"home address" not in cleaned, "JPEG comment survived strip"
    out = Image.open(BytesIO(cleaned))
    out.load()
    assert "icc_profile" not in out.info, "ICC profile survived strip"
    # Pillow exposes parsed XMP under an ``info`` key; it must be absent.
    assert not any(k.lower().startswith("xml") for k in out.info), (
        f"XMP-shaped key survived strip: {out.info.keys()}"
    )


def test_strip_metadata_passes_through_video_bytes():
    # Non-image content type: no transform attempted, identical bytes back.
    payload = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    result = strip_metadata(payload, "video/mp4")
    assert result == payload


def test_strip_metadata_raises_on_corrupt_image():
    """A 4-byte JPEG stub (SOI + EOI only) surfaces as ``EvidenceProcessingError`` before any storage write."""
    with pytest.raises(EvidenceProcessingError) as refused:
        strip_metadata(b"\xff\xd8\xff\xd9", "image/jpeg")

    assert str(refused.value) == UNREADABLE_IMAGE_MESSAGE


def test_strip_metadata_raises_on_truncated_image():
    """A truncated JPEG opens, then fails to decode; same message as an unreadable file."""
    whole = _solid_jpeg(64, 64)

    with pytest.raises(EvidenceProcessingError) as refused:
        strip_metadata(whole[: len(whole) // 2], "image/jpeg")

    assert str(refused.value) == UNREADABLE_IMAGE_MESSAGE


def test_strip_metadata_rejects_decompression_bomb(monkeypatch):
    """A small file declaring oversized dimensions 400s before Pillow allocates the pixel buffer.

    The ``width * height > MAX_DECODED_PIXELS`` check on the lazy ``Image.open(...).size``
    is the defence. Pillow's own cap is not narrowed globally (it would race across
    concurrent ``asyncio.to_thread`` calls). The regex accepts either error wording.
    """
    from app.services import evidence_processing as ep

    img = Image.new("RGB", (4, 4), "white")
    buf = BytesIO()
    img.save(buf, format="JPEG")

    monkeypatch.setattr(ep, "MAX_DECODED_PIXELS", 4)  # 3×3+ trips it
    with pytest.raises(EvidenceProcessingError, match="(pixel cap|decompression bomb)"):
        ep.strip_metadata(buf.getvalue(), "image/jpeg")

    # The cap restored, the same image strips fine.
    monkeypatch.undo()
    assert ep.strip_metadata(buf.getvalue(), "image/jpeg")


def test_strip_metadata_preserves_palette_png_colours():
    """A palette-mode PNG comes back as a real-colour image, not black.

    Regression: rebuilding a ``mode == "P"`` image with ``Image.frombytes`` lost the palette.
    """
    img = Image.new("RGB", (4, 4), (15, 50, 200)).convert("P", palette=Image.Palette.ADAPTIVE)
    buf = BytesIO()
    img.save(buf, format="PNG")

    cleaned = strip_metadata(buf.getvalue(), "image/png")
    out = Image.open(BytesIO(cleaned))
    out.load()

    # RGB/RGBA, not palette.
    assert out.mode in {"RGB", "RGBA"}
    pixel = out.getpixel((0, 0))
    # The blue channel must dominate; the bug zeroed all channels.
    assert pixel[2] > 100, f"palette PNG lost colour during strip — got {pixel}"


def test_strip_metadata_preserves_palette_png_transparency():
    """A palette PNG with a ``tRNS`` chunk comes back as RGBA with alpha intact.

    Guards the tRNS path; ``has_transparency_data`` also covers ``mode == "PA"``.
    """
    # One fully transparent and one opaque palette entry.
    img = Image.new("P", (4, 4))
    img.putpalette([255, 0, 0, 0, 0, 255], "RGB")  # idx 0 red, idx 1 blue
    img.info["transparency"] = bytes([0, 255])  # idx 0 transparent, idx 1 opaque
    # The corner pixel uses the transparent index.
    img.putpixel((0, 0), 0)
    img.putpixel((3, 3), 1)
    buf = BytesIO()
    img.save(buf, format="PNG")

    cleaned = strip_metadata(buf.getvalue(), "image/png")
    out = Image.open(BytesIO(cleaned))
    out.load()

    assert out.mode == "RGBA", f"palette tRNS lost alpha — got mode={out.mode}"
    assert out.getpixel((0, 0))[3] < 64, (
        f"transparent palette pixel rebuilt as opaque — got alpha={out.getpixel((0, 0))[3]}"
    )


def test_strip_metadata_rejects_animated_webp():
    """Animated WebP / APNG is rejected: flattening to one frame would silently lose the footage."""
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


def test_max_decoded_pixels_clears_realistic_camera_output():
    """The decode cap stays at or above ~50 MP phone cameras."""
    assert MAX_DECODED_PIXELS >= 50_000_000


def _solid_jpeg(width: int, height: int) -> bytes:
    """A real JPEG of the requested dimensions."""
    img = Image.new("RGB", (width, height), "red")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_make_jpeg_derivative_clamps_longer_edge_to_max_dim():
    """The longer edge equals ``max_dim`` exactly for a larger input; aspect ratio is preserved."""
    raw = _solid_jpeg(3200, 1600)  # 2:1 landscape
    out = make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert max(decoded.size) == HERO_MAX_DIM, decoded.size
    assert decoded.size == (HERO_MAX_DIM, HERO_MAX_DIM // 2)
    assert decoded.format == "JPEG"


def test_make_jpeg_derivative_does_not_upscale_smaller_images():
    """``Image.thumbnail`` does not upscale: 200x100 through the 400-max path stays 200x100."""
    raw = _solid_jpeg(200, 100)
    out = make_jpeg_derivative(raw, "image/jpeg", THUMBNAIL_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert decoded.size == (200, 100)


def test_make_jpeg_derivative_always_outputs_jpeg_for_png_input():
    """PNG sources are re-encoded as JPEG: every derivative ends in ``.jpg`` so the frontend naming derivation is unambiguous."""
    img = Image.new("RGBA", (800, 600), (255, 0, 0, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    out = make_jpeg_derivative(raw, "image/png", THUMBNAIL_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    assert decoded.format == "JPEG"
    # JPEG cannot carry transparency.
    assert decoded.mode == "RGB"


def test_make_jpeg_derivative_returns_video_bytes_unchanged():
    """Videos pass through unchanged, as in ``strip_metadata``."""
    payload = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"  # MP4 header signature, not parsed
    out = make_jpeg_derivative(payload, "video/mp4", HERO_MAX_DIM)
    assert out is payload


def test_make_jpeg_derivative_rejects_corrupt_image():
    """A corrupt input raises ``EvidenceProcessingError`` (router 400), not an uncaught Pillow 500."""
    with pytest.raises(EvidenceProcessingError) as refused:
        make_jpeg_derivative(b"not-a-jpeg", "image/jpeg", HERO_MAX_DIM)

    assert str(refused.value) == UNREADABLE_IMAGE_MESSAGE


def test_make_jpeg_derivative_rejects_decompression_bomb(monkeypatch):
    """``max_dim`` does not override the bomb cap (lowered here by monkeypatch to keep the fixture small)."""
    monkeypatch.setattr("app.services.evidence_processing.MAX_DECODED_PIXELS", 2500)
    raw = _solid_jpeg(100, 100)  # 10_000 pixels — above the patched cap
    with pytest.raises(EvidenceProcessingError, match="pixel cap"):
        make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)


def test_hero_is_larger_than_thumbnail():
    """Swapping the constants would invert the bandwidth budget across every render surface."""
    assert HERO_MAX_DIM > THUMBNAIL_MAX_DIM


def test_make_jpeg_derivative_bakes_in_exif_orientation():
    """EXIF Orientation 6 is applied before resize so the derivative matches the browser rendering of the original.

    The demo-seed-pool path skips ``strip_metadata``, so the original keeps its EXIF.
    """
    # 200x100 landscape JPEG with Orientation 6: after ``exif_transpose`` the raster is 100x200.
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

    # Without exif_transpose the source is 200x100.
    assert Image.open(BytesIO(raw)).size == (200, 100)

    out = make_jpeg_derivative(raw, "image/jpeg", HERO_MAX_DIM)
    decoded = Image.open(BytesIO(out))
    # Pixel dimensions are swapped; no upscaling on small inputs.
    assert decoded.size == (100, 200), (
        f"EXIF Orientation 6 not baked into derivative — got {decoded.size}, expected (100, 200)"
    )


def _jpeg_with_orientation(orientation: int, size: tuple[int, int]) -> bytes:
    """A JPEG carrying only an EXIF Orientation tag (value 6), as a phone writes it."""
    img = Image.new("RGB", size, "red")
    exif = img.getexif()
    exif[274] = orientation
    buf = BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_strip_metadata_applies_exif_orientation_before_dropping_it():
    """A rotated photo comes out upright.

    The strip drops Orientation with the rest of the metadata, so it must
    apply the tag first; every derivative inherits the stripped copy.
    """
    stripped = strip_metadata(_jpeg_with_orientation(6, (200, 100)), "image/jpeg")

    out = Image.open(BytesIO(stripped))
    # 200x100 landscape + rotate 90 = 100x200 portrait.
    assert out.size == (100, 200)
    # The tag is gone, so no viewer rotates a second time.
    assert out.getexif().get(274) is None


def test_strip_metadata_leaves_an_unrotated_image_alone():
    """Orientation 1 ("as stored") leaves dimensions unchanged."""
    stripped = strip_metadata(_jpeg_with_orientation(1, (200, 100)), "image/jpeg")

    assert Image.open(BytesIO(stripped)).size == (200, 100)


def _encoded(fmt: str, mode: str = "RGB") -> bytes:
    buf = BytesIO()
    Image.new(mode, (4, 4)).save(buf, format=fmt)
    return buf.getvalue()


_MAGIC = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/webp": b"RIFF",
}


@pytest.mark.parametrize(
    ("fmt", "mode", "declared"),
    [
        ("WEBP", "RGB", "image/jpeg"),
        ("PNG", "RGBA", "image/jpeg"),
        ("JPEG", "RGB", "image/png"),
        ("JPEG", "CMYK", "image/png"),
        ("JPEG", "CMYK", "image/webp"),
    ],
)
def test_strip_metadata_stores_any_accepted_format_as_the_declared_type(fmt, mode, declared):
    """A JPEG, PNG or WebP is accepted whatever type it declares and stored as the declared type."""
    cleaned = strip_metadata(_encoded(fmt, mode), declared)

    assert cleaned.startswith(_MAGIC[declared])


@pytest.mark.parametrize(("fmt", "declared"), [("TIFF", "image/png"), ("GIF", "image/jpeg")])
def test_strip_metadata_refuses_a_format_it_does_not_accept(fmt, declared):
    """Bytes no allowed decoder reads are refused, with a message naming the allowed formats."""
    with pytest.raises(EvidenceProcessingError) as refused:
        strip_metadata(_encoded(fmt), declared)

    assert str(refused.value) == UNREADABLE_IMAGE_MESSAGE


def test_every_accepted_image_type_strips_to_its_own_format():
    """The decoders tried are those of the upload allowlist; each type strips to its own format."""
    Image.init()
    pillow_format = {mime: fmt for fmt, mime in Image.MIME.items()}
    assert set(_ACCEPTED_FORMATS) == {pillow_format[t] for t in ALLOWED_IMAGE_TYPES}
    for content_type in ALLOWED_IMAGE_TYPES:
        fmt = pillow_format[content_type]
        cleaned = strip_metadata(_encoded(fmt), content_type)
        assert Image.open(BytesIO(cleaned)).format == fmt


_SENTINEL = "SENTINEL-48.8566N-2.3522E"


def _with_every_metadata_chunk(fmt: str) -> bytes:
    img = Image.new("RGB", (8, 8), "blue")
    exif = img.getexif()
    exif[0x010F] = _SENTINEL  # Make
    params = {"exif": exif, "icc_profile": _SENTINEL.encode() * 4}
    if fmt == "PNG":
        text = PngImagePlugin.PngInfo()
        text.add_text("Comment", _SENTINEL)
        text.add_text("Author", _SENTINEL, zip=True)
        text.add_itxt("Description", _SENTINEL)
        params["pnginfo"] = text
    else:
        params["xmp"] = f"<x:xmpmeta>{_SENTINEL}</x:xmpmeta>".encode()
    buf = BytesIO()
    img.save(buf, format=fmt, **params)
    return buf.getvalue()


@pytest.mark.parametrize(
    ("fmt", "content_type", "chunks"),
    [
        ("PNG", "image/png", (b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP")),
        ("WEBP", "image/webp", (b"EXIF", b"XMP ", b"ICCP")),
    ],
)
def test_strip_metadata_removes_every_metadata_chunk(fmt, content_type, chunks):
    """PNG text, EXIF and ICC chunks and WebP EXIF, XMP and ICC chunks are gone."""
    raw = _with_every_metadata_chunk(fmt)
    assert all(chunk in raw for chunk in chunks), "fixture must carry every chunk"

    cleaned = strip_metadata(raw, content_type)

    assert [chunk for chunk in chunks if chunk in cleaned] == []
    assert _SENTINEL.encode() not in cleaned
    with Image.open(BytesIO(cleaned)) as out:
        assert dict(out.getexif()) == {}
        assert {"exif", "icc_profile", "xmp"}.isdisjoint(out.info)


def test_at_most_max_concurrent_decodes_run_at_once(monkeypatch):
    """At most ``MAX_CONCURRENT_DECODES`` images are open at once (``Image.open`` to the end of its ``with``), bounding raster memory."""
    held: set[int] = set()
    most = 0
    lock = threading.Lock()
    real_open = Image.open
    real_exit = ImageFile.ImageFile.__exit__

    def slow_open(*args, **kwargs):
        nonlocal most
        img = real_open(*args, **kwargs)
        with lock:
            held.add(id(img))
            most = max(most, len(held))
        time.sleep(0.02)
        return img

    def tracked_exit(self, *args):
        with lock:
            held.discard(id(self))
        return real_exit(self, *args)

    monkeypatch.setattr(Image, "open", slow_open)
    monkeypatch.setattr(ImageFile.ImageFile, "__exit__", tracked_exit)
    uploads = MAX_CONCURRENT_DECODES + 3
    png = _encoded("PNG")
    with ThreadPoolExecutor(max_workers=uploads) as pool:
        list(pool.map(lambda _: strip_metadata(png, "image/png"), range(uploads)))

    assert most == MAX_CONCURRENT_DECODES
