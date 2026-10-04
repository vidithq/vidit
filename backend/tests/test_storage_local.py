import io
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from app.services import storage as storage_module
from app.services.storage import (
    LOCAL_STORAGE_MOUNT_PATH,
    LOCAL_STORAGE_URL_PREFIX,
    LocalStorage,
    StorageDeleteError,
    derivative_key,
    sweep_keys,
    upload_file,
)


@pytest.fixture(autouse=True)
def _local_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))


def _upload_file(name: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        filename=name, file=io.BytesIO(content), headers={"content-type": content_type}
    )


async def test_local_storage_upload_writes_file_and_returns_url(tmp_path: Path):
    import hashlib

    backend = LocalStorage(tmp_path)
    file = _upload_file("evidence.jpg", b"fake-image-bytes", "image/jpeg")

    result = await backend.upload(file, "uploads/abc/evidence.jpg")

    written = tmp_path / "uploads" / "abc" / "evidence.jpg"
    assert written.read_bytes() == b"fake-image-bytes"
    assert result.url == f"{LOCAL_STORAGE_URL_PREFIX}/uploads/abc/evidence.jpg"
    assert backend.public_url("uploads/abc/evidence.jpg") == result.url
    assert result.sha256 == hashlib.sha256(b"fake-image-bytes").hexdigest()


async def test_local_storage_upload_bytes_writes_payload(tmp_path: Path):
    import hashlib

    backend = LocalStorage(tmp_path)

    result = await backend.upload_bytes(b"raw-bytes", "seed/demo/x.png", "image/png")

    assert (tmp_path / "seed" / "demo" / "x.png").read_bytes() == b"raw-bytes"
    assert result.url.endswith("/seed/demo/x.png")
    assert result.sha256 == hashlib.sha256(b"raw-bytes").hexdigest()


async def test_upload_file_helper_routes_through_local(tmp_path: Path):
    """Images go through the EXIF-strip pipeline, so the stored file is the re-encoded
    copy and the hash is of what landed, not of the input."""
    import hashlib

    from tests._fixtures import TINY_JPEG

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    result = await upload_file(file, geo_id)

    assert result.url.startswith(f"{LOCAL_STORAGE_URL_PREFIX}/uploads/{geo_id}/")
    assert result.url.endswith(".jpg")
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    on_disk = (tmp_path / relative).read_bytes()
    assert on_disk != TINY_JPEG
    assert result.sha256 == hashlib.sha256(on_disk).hexdigest()


async def test_upload_file_writes_hero_and_thumbnail_derivatives(tmp_path: Path):
    """An image upload lands three objects: original, hero (max-dim 1280) and thumbnail
    (max-dim 400). The ``_hero.jpg`` / ``_thumb.jpg`` naming is shared with the
    frontend ``mediaUrls``."""
    from io import BytesIO as _BytesIO

    from PIL import Image as PILImage

    from tests._fixtures import TINY_JPEG

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    result = await upload_file(file, geo_id)

    original_relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    assert (tmp_path / original_relative).exists(), "original missing on disk"

    # Derivative keys ride the result so a rollback can sweep them.
    assert len(result.derivative_keys) == 2
    hero_key = derivative_key(original_relative, "hero")
    thumb_key = derivative_key(original_relative, "thumb")
    assert hero_key in result.derivative_keys
    assert thumb_key in result.derivative_keys

    hero_bytes = (tmp_path / hero_key).read_bytes()
    thumb_bytes = (tmp_path / thumb_key).read_bytes()
    assert PILImage.open(_BytesIO(hero_bytes)).format == "JPEG"
    assert PILImage.open(_BytesIO(thumb_bytes)).format == "JPEG"


async def test_upload_file_derives_extension_from_content_type_not_filename(tmp_path: Path):
    """The S3 key extension comes from the validated MIME type, not the
    attacker-controlled ``file.filename`` (long suffix, RTL override, lying extension)."""
    geo_id = uuid4()
    # '.html' on a video/mp4 payload: the content type wins.
    file = _upload_file("evil.html", b"fake-mp4-bytes", "video/mp4")

    result = await upload_file(file, geo_id)

    assert result.url.endswith(".mp4")


async def test_upload_file_skips_derivatives_for_video(tmp_path: Path):
    """Videos produce no JPEG derivatives, so a rollback sweeps no missing sibling keys."""
    geo_id = uuid4()
    file = _upload_file("clip.mp4", b"fake-mp4-bytes", "video/mp4")

    result = await upload_file(file, geo_id)
    assert result.derivative_keys == ()


def test_derivative_key_appends_suffix_and_forces_jpeg_extension():
    """Mirrored by the frontend ``mediaUrls.ts``; change both."""
    assert derivative_key("uploads/abc/xyz.jpg", "hero") == "uploads/abc/xyz_hero.jpg"
    assert derivative_key("uploads/abc/xyz.png", "thumb") == "uploads/abc/xyz_thumb.jpg"
    assert (
        derivative_key("detected/geo-01/media/photo.webp", "hero")
        == "detected/geo-01/media/photo_hero.jpg"
    )


def test_derivative_key_preserves_dot_bearing_stems():
    """Filenames like ``photo.v2.jpg`` keep their internal dots.

    ``Path.with_suffix("")`` only drops the *final* suffix, so a stem
    with versioning-style dots stays intact. The frontend's
    ``mediaUrls`` mirror must handle this the same way or a future
    versioned-filename convention silently 404s.
    """
    assert derivative_key("uploads/abc/photo.v2.jpg", "hero") == "uploads/abc/photo.v2_hero.jpg"


def test_derivative_key_handles_extensionless_keys():
    """An extensionless key does not crash: ``.jpg`` is appended."""
    assert derivative_key("uploads/abc/photo", "hero") == "uploads/abc/photo_hero.jpg"


async def test_upload_file_sweeps_partial_triple_on_mid_flight_failure(tmp_path: Path, monkeypatch):
    """A hero or thumb failure after the original landed sweeps the original and any
    derivative before the exception propagates (best effort), so the bucket never
    holds a partial triple."""
    from tests._fixtures import TINY_JPEG

    # Patch the class: ``get_storage`` builds a fresh backend per call.
    real_upload_bytes = LocalStorage.upload_bytes
    call_count = {"n": 0}

    async def flaky_upload_bytes(self, data, key, content_type):
        call_count["n"] += 1
        # Call 1 is the original, call 2 the hero (fails).
        if call_count["n"] == 2:
            raise RuntimeError("simulated hero PUT failure")
        return await real_upload_bytes(self, data, key, content_type)

    monkeypatch.setattr(LocalStorage, "upload_bytes", flaky_upload_bytes)

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    with pytest.raises(RuntimeError, match="simulated hero PUT failure"):
        await upload_file(file, geo_id)

    geo_dir = tmp_path / "uploads" / str(geo_id)
    leftovers = list(geo_dir.iterdir()) if geo_dir.exists() else []
    assert leftovers == [], (
        f"mid-flight sweep failed — partial upload left behind: {[p.name for p in leftovers]}"
    )


async def test_upload_proof_image_skips_derivatives(tmp_path: Path):
    """``upload_proof_image`` sets ``produce_derivatives=False``: proofs render the
    raw URL, so derivatives would be objects nothing fetches."""
    from app.services.storage import upload_proof_image
    from tests._fixtures import TINY_JPEG

    user_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    result = await upload_proof_image(file, user_id)

    assert result.derivative_keys == ()
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    assert (tmp_path / relative).exists()
    hero = tmp_path / derivative_key(relative, "hero")
    thumb = tmp_path / derivative_key(relative, "thumb")
    assert not hero.exists()
    assert not thumb.exists()


async def test_local_storage_round_trips_through_static_files_mount(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    file = _upload_file("evidence.jpg", b"served-bytes", "image/jpeg")
    _ = await backend.upload(file, "uploads/abc/evidence.jpg")

    test_app = FastAPI()
    test_app.mount(LOCAL_STORAGE_MOUNT_PATH, StaticFiles(directory=tmp_path))

    response = TestClient(test_app).get(f"{LOCAL_STORAGE_MOUNT_PATH}/uploads/abc/evidence.jpg")

    assert response.status_code == 200
    assert response.content == b"served-bytes"


def test_local_storage_key_from_url_inverts_public_url(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    key = "proof/u/abc.jpg"
    assert backend.key_from_url(backend.public_url(key)) == key


def test_local_storage_key_from_url_rejects_unknown_prefix(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    assert backend.key_from_url("https://example.com/proof/u/abc.jpg") is None


def test_local_storage_delete_many_removes_files(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    (tmp_path / "proof" / "u").mkdir(parents=True)
    (tmp_path / "proof" / "u" / "a.jpg").write_bytes(b"a")
    (tmp_path / "proof" / "u" / "b.jpg").write_bytes(b"b")

    backend.delete_many(["proof/u/a.jpg", "proof/u/b.jpg", "proof/u/missing.jpg"])

    assert not (tmp_path / "proof" / "u" / "a.jpg").exists()
    assert not (tmp_path / "proof" / "u" / "b.jpg").exists()


def test_local_storage_delete_many_prunes_empty_parent_dirs(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    (tmp_path / "proof" / "u").mkdir(parents=True)
    (tmp_path / "proof" / "u" / "a.jpg").write_bytes(b"a")

    backend.delete_many(["proof/u/a.jpg"])

    assert not (tmp_path / "proof" / "u").exists()
    assert not (tmp_path / "proof").exists()
    assert tmp_path.exists()  # storage root stays


def test_local_storage_delete_many_keeps_nonempty_parent_dirs(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    (tmp_path / "proof" / "u").mkdir(parents=True)
    (tmp_path / "proof" / "u" / "a.jpg").write_bytes(b"a")
    (tmp_path / "proof" / "u" / "b.jpg").write_bytes(b"b")

    backend.delete_many(["proof/u/a.jpg"])

    # The parent dir stays while a sibling remains.
    assert (tmp_path / "proof" / "u" / "b.jpg").exists()
    assert (tmp_path / "proof" / "u").exists()


@pytest.mark.parametrize("key", ["../outside.jpg", "proof/../../outside.jpg", "/etc/passwd"])
def test_local_storage_path_rejects_escaping_keys(tmp_path: Path, key: str):
    backend = LocalStorage(tmp_path / "root")
    with pytest.raises(ValueError, match="escapes the root"):
        backend._path(key)


@pytest.mark.parametrize("key", ["../outside.jpg", "/etc/passwd"])
def test_local_storage_head_size_returns_none_for_escaping_keys(tmp_path: Path, key: str):
    backend = LocalStorage(tmp_path / "root")
    (tmp_path / "outside.jpg").write_bytes(b"secret")
    assert backend.head_size(key) is None


def test_local_storage_head_size_reads_valid_key(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    (tmp_path / "proof" / "u").mkdir(parents=True)
    (tmp_path / "proof" / "u" / "a.jpg").write_bytes(b"abc")
    assert backend.head_size("proof/u/a.jpg") == 3
    assert backend.head_size("proof/u/missing.jpg") is None


def test_local_storage_delete_many_skips_escaping_keys(tmp_path: Path):
    backend = LocalStorage(tmp_path / "root")
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"keep")
    (tmp_path / "root" / "proof").mkdir()
    (tmp_path / "root" / "proof" / "a.jpg").write_bytes(b"a")

    backend.delete_many(["../outside.jpg", str(outside), "proof/a.jpg"])

    assert outside.read_bytes() == b"keep"
    assert not (tmp_path / "root" / "proof").exists()
    assert (tmp_path / "root").exists()


# ── sweep_keys ────────────────────────────────────────────────────────────


def test_sweep_keys_empty_list_short_circuits(tmp_path: Path, monkeypatch):
    """Empty input does not resolve ``get_storage()`` (cleanup paths call it when nothing landed)."""
    called = False

    def _fail_if_called() -> object:
        nonlocal called
        called = True
        raise AssertionError("get_storage() must not be called on empty input")

    monkeypatch.setattr(storage_module, "get_storage", _fail_if_called)
    sweep_keys([], context="empty-input test")
    assert called is False


def test_sweep_keys_happy_path_deletes_files(tmp_path: Path):
    (tmp_path / "proof" / "u").mkdir(parents=True)
    (tmp_path / "proof" / "u" / "a.jpg").write_bytes(b"a")
    (tmp_path / "proof" / "u" / "b.jpg").write_bytes(b"b")

    sweep_keys(["proof/u/a.jpg", "proof/u/b.jpg"], context="happy path")

    assert not (tmp_path / "proof" / "u" / "a.jpg").exists()
    assert not (tmp_path / "proof" / "u" / "b.jpg").exists()


def test_sweep_keys_swallows_storage_delete_error_and_logs(tmp_path: Path, monkeypatch, caplog):
    """A ``StorageDeleteError`` must not propagate: the DB side is committed, so a throw would be a 500."""

    def _raise_partial(self, keys: list[str]) -> None:
        raise StorageDeleteError({"a.jpg": "AccessDenied: blocked"})

    monkeypatch.setattr(LocalStorage, "delete_many", _raise_partial)
    with caplog.at_level("ERROR"):
        sweep_keys(["a.jpg"], context="partial-failure test")

    assert any(
        "S3 sweep failed (partial-failure test)" in r.message
        and "1/1 object(s) failed to delete" in r.message
        for r in caplog.records
    )


def test_sweep_keys_swallows_unexpected_error_and_logs(tmp_path: Path, monkeypatch, caplog):
    """Transport failures (not ``StorageDeleteError``) are also swallowed and logged."""

    def _raise_runtime(self, keys: list[str]) -> None:
        raise RuntimeError("connection reset")

    monkeypatch.setattr(LocalStorage, "delete_many", _raise_runtime)
    with caplog.at_level("ERROR"):
        sweep_keys(["a.jpg", "b.jpg"], context="transport-failure test")

    assert any(
        "S3 sweep failed (transport-failure test)" in r.message
        and "2 candidate object(s)" in r.message
        for r in caplog.records
    )


def test_main_app_registers_local_storage_mount():
    from app.main import app

    paths = {getattr(route, "path", None) for route in app.routes}
    assert LOCAL_STORAGE_MOUNT_PATH in paths


# ── safe_original_filename ────────────────────────────────────────────────


def test_safe_original_filename_none_and_empty():
    """Empty or whitespace input gives ``None`` (column stays NULL)."""
    from app.services.storage import safe_original_filename

    assert safe_original_filename(None) is None
    assert safe_original_filename("") is None
    assert safe_original_filename("   ") is None


def test_safe_original_filename_strips_path_components():
    """Traversal and Windows-style paths are stripped to the basename: the multipart
    filename is attacker-controlled and lands on a public column."""
    from app.services.storage import safe_original_filename

    assert safe_original_filename("../../etc/passwd") == "passwd"
    assert safe_original_filename("..\\..\\windows\\system32") == "system32"
    assert safe_original_filename("/absolute/path/file.jpg") == "file.jpg"
    assert safe_original_filename("legit.jpg") == "legit.jpg"


def test_safe_original_filename_rejects_control_and_format_codepoints():
    """``Cc`` control and ``Cf`` format codepoints (NUL, newline, RTL override,
    zero-width joiners, bidi isolates, BOM) give ``None``; the category check is
    the defence, not an enumerated list."""
    from app.services.storage import safe_original_filename

    # Cc — control characters.
    assert safe_original_filename("evil\x00.jpg") is None
    assert safe_original_filename("split\nline.jpg") is None
    assert safe_original_filename("tab\there.jpg") is None
    assert safe_original_filename("esc\x1b.jpg") is None
    # Cf — format characters.
    assert safe_original_filename("hide‮extn.jpg") is None  # RTL override
    assert safe_original_filename("ltr‎mark.jpg") is None  # LTR mark
    assert safe_original_filename("zwj‍joiner.jpg") is None  # zero-width joiner
    assert safe_original_filename("bom﻿trick.jpg") is None  # BOM
    assert safe_original_filename("iso⁦late.jpg") is None  # first strong isolate


def test_safe_original_filename_caps_length():
    """Values past 255 chars (the NTFS / ext4 name max) are truncated."""
    from app.services.storage import ORIGINAL_FILENAME_MAX_LEN, safe_original_filename

    long_name = "a" * 500 + ".jpg"
    cleaned = safe_original_filename(long_name)
    assert cleaned is not None
    assert len(cleaned) == ORIGINAL_FILENAME_MAX_LEN


def test_safe_original_filename_passes_through_html_shaped_strings():
    """HTML-shaped chars without slashes pass through: escaping is the renderer's job,
    and insert-time sanitising would corrupt names containing ``&``."""
    from app.services.storage import safe_original_filename

    assert safe_original_filename("<img src=x>.jpg") == "<img src=x>.jpg"
    assert safe_original_filename("AT&T-logo.png") == "AT&T-logo.png"
    assert safe_original_filename('quote"name.png') == 'quote"name.png'


def test_safe_original_filename_path_strip_overrides_html_chars():
    """A name that is both path-shaped and HTML-shaped is path-stripped first
    (``</script>`` keeps only the fragment after the slash)."""
    from app.services.storage import safe_original_filename

    assert safe_original_filename("<script>alert(1)</script>.jpg") == "script>.jpg"
