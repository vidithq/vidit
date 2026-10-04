"""Shared test fixtures: upload bytes, the X-export file every archive test
writes, and direct reads / writes of the local storage root.

The JPEG is real image bytes (the EXIF strip pre-decodes via Pillow, which
rejects a stub). It is embedded as hex so collection needs no Pillow.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.sanitize import tiptap_doc_from_text, tiptap_doc_text
from app.services.tweet_ingest.records import TweetRecord


def stored_path(key: str) -> Path:
    """Where ``LocalStorage`` puts ``key``, read at call time so a repointed ``local_storage_dir`` is followed."""
    return Path(settings.local_storage_dir) / key


def stored_bytes(key: str) -> bytes:
    """What storage holds at ``key``; raises ``FileNotFoundError`` on a miss.

    The production protocol has no whole-object read (archives stream via ``get_to_path``).
    """
    return stored_path(key).read_bytes()


def store_bytes(data: bytes, key: str) -> None:
    """Stage ``data`` at ``key`` on the local root, skipping the upload path."""
    path = stored_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def write_archive_js(dest: Path, entries: list[dict[str, Any]]) -> None:
    """Write ``tweets.js`` under ``dest`` from raw X-export tweet dicts."""
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps([{"tweet": e} for e in entries]),
        encoding="utf-8",
    )


# 1×1 red JPEG, no EXIF, no ICC.
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

# Stand-in mp4 bytes: ingest stores videos without decoding them.
TINY_MP4: bytes = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomFAKE"


def tweet_record(**kw: Any) -> TweetRecord:
    """A ``TweetRecord`` with defaults for the fields a test does not care about."""
    base: dict[str, Any] = {
        "tweet_id": "1",
        "handle": "analyst",
        "text": "",
        "created_at": "2025-11-12T14:33:00Z",
    }
    base.update(kw)
    return TweetRecord(**base)


def collection_description(text: str = "What this shelf holds.") -> dict[str, Any]:
    """The Tiptap description and its plain-text projection a ``collections`` row stores.

    Spread it into the constructor: ``Collection(..., **collection_description("…"))``.
    """
    doc = tiptap_doc_from_text(text)
    return {"description": doc, "description_text": tiptap_doc_text(doc)}


def tiny_jpeg(filename: str = "tiny.jpg") -> tuple[str, bytes, str]:
    """A ``(filename, bytes, content_type)`` tuple for ``TestClient`` multipart."""
    return (filename, TINY_JPEG, "image/jpeg")
