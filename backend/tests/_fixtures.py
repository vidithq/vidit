"""Shared upload-path test fixtures.

Real (non-stub) image bytes. The previous ``b"\\xff\\xd8\\xff\\xd9"``
4-byte JPEG stub satisfied content-type sniffing but Pillow rejects
it as ``UnidentifiedImageError``, which broke every upload test once
the EXIF-strip pass landed (since the strip pre-decodes via PIL).

We embed the bytes as hex so the test module doesn't need Pillow at
collection time — generated once via:

    img = Image.new("RGB", (1, 1), color="red")
    img.save(buf, format="JPEG", quality=95)
"""

from __future__ import annotations

# 1×1 red JPEG, ~635 bytes, no EXIF, no ICC. Round-trips through any
# image decoder (Pillow, libvips, browser, OS preview) cleanly.
_TINY_JPEG_HEX = (
    "ffd8ffe000104a46494600010100000100010000ffdb0043000201010101010201010102020202020403020202020504040304060506060605060606070908060709070606080b08090a0a0a0a0a06080b0c0b0a0c090a0a0a"
    "ffdb004301020202020202050303050a0706070a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"
    "ffc00011080001000103012200021101031101"
    "ffc4001f0000010501010101010100000000000000000102030405060708090a0b"
    "ffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa"
    "ffc4001f0100030101010101010101010000000000000102030405060708090a0b"
    "ffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa"
    "ffda000c03010002110311003f00f8be8a28afe533fdfc3f"
    "ffd9"
)

TINY_JPEG: bytes = bytes.fromhex(_TINY_JPEG_HEX)


def tiny_jpeg(filename: str = "tiny.jpg") -> tuple[str, bytes, str]:
    """Drop-in replacement for ``_tiny_jpeg()`` — works with FastAPI's
    ``TestClient`` multipart helpers. Returns a tuple of
    ``(filename, bytes, content_type)``.
    """
    return (filename, TINY_JPEG, "image/jpeg")
