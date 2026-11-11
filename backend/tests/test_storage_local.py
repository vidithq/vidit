from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from app.services import storage as storage_module
from app.services.storage import (
    LOCAL_STORAGE_MOUNT_PATH,
    LOCAL_STORAGE_URL_PREFIX,
    LocalStorage,
    StorageDeleteError,
    derivative_key,
    store,
    sweep_keys,
    upload_source_file,
)
from tests._fixtures import upload_file


@pytest.fixture(autouse=True)
def _local_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))


async def test_local_storage_stores_a_file_and_returns_url(tmp_path: Path):
    import hashlib

    backend = LocalStorage(tmp_path)
    file = upload_file("evidence.jpg", b"fake-image-bytes", "image/jpeg")

    result = await store(backend, file.file, "uploads/abc/evidence.jpg", "image/jpeg")

    written = tmp_path / "uploads" / "abc" / "evidence.jpg"
    assert written.read_bytes() == b"fake-image-bytes"
    assert result.url == f"{LOCAL_STORAGE_URL_PREFIX}/uploads/abc/evidence.jpg"
    assert backend.public_url("uploads/abc/evidence.jpg") == result.url
    assert result.sha256 == hashlib.sha256(b"fake-image-bytes").hexdigest()


async def test_local_storage_stores_bytes(tmp_path: Path):
    import hashlib

    backend = LocalStorage(tmp_path)

    result = await store(backend, b"raw-bytes", "seed/demo/x.png", "image/png")

    assert (tmp_path / "seed" / "demo" / "x.png").read_bytes() == b"raw-bytes"
    assert result.url.endswith("/seed/demo/x.png")
    assert result.sha256 == hashlib.sha256(b"raw-bytes").hexdigest()


async def test_upload_source_file_helper_routes_through_local(tmp_path: Path):
    """Images go through the EXIF-strip pipeline, so the stored file is the re-encoded
    copy and the hash is of what landed, not of the input."""
    import hashlib

    from tests._fixtures import TINY_JPEG

    file = upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    [(result, _)] = await upload_source_file(file)

    assert result.url.startswith(f"{LOCAL_STORAGE_URL_PREFIX}/uploads/")
    assert result.url.endswith(".jpg")
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    on_disk = (tmp_path / relative).read_bytes()
    assert on_disk != TINY_JPEG
    assert result.sha256 == hashlib.sha256(on_disk).hexdigest()


async def test_upload_source_file_writes_hero_and_thumbnail_derivatives(tmp_path: Path):
    """An image upload lands three objects: original, hero (max-dim 1280) and thumbnail
    (max-dim 400). The ``_hero.jpg`` / ``_thumb.jpg`` naming is shared with the
    frontend ``mediaUrls``."""
    from io import BytesIO as _BytesIO

    from PIL import Image as PILImage

    from tests._fixtures import TINY_JPEG

    file = upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    [(result, _)] = await upload_source_file(file)

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


async def test_upload_source_file_derives_extension_from_content_type_not_filename(tmp_path: Path):
    """The S3 key extension comes from the validated MIME type, not the
    attacker-controlled ``file.filename`` (long suffix, RTL override, lying extension)."""
    # '.html' on a video/mp4 payload: the content type wins.
    file = upload_file("evil.html", b"fake-mp4-bytes", "video/mp4")

    [(result, _)] = await upload_source_file(file)

    assert result.url.endswith(".mp4")


async def test_upload_source_file_skips_derivatives_for_video(tmp_path: Path):
    """Videos produce no JPEG derivatives, so a rollback sweeps no missing sibling keys."""
    file = upload_file("clip.mp4", b"fake-mp4-bytes", "video/mp4")

    [(result, _)] = await upload_source_file(file)
    assert result.derivative_keys == ()


@pytest.mark.parametrize(
    ("key", "derivative"),
    [
        ("uploads/abc/xyz.jpg", "uploads/abc/xyz_hero.jpg"),
        ("uploads/abc/xyz.png", "uploads/abc/xyz_hero.jpg"),
        ("detected/geo-01/media/photo.webp", "detected/geo-01/media/photo_hero.jpg"),
        # ``Path.with_suffix("")`` drops the final suffix only, so versioning dots stay.
        ("uploads/abc/photo.v2.jpg", "uploads/abc/photo.v2_hero.jpg"),
        ("uploads/abc/photo", "uploads/abc/photo_hero.jpg"),
    ],
)
def test_derivative_key_appends_suffix_and_forces_jpeg_extension(key, derivative):
    """Mirrored by the frontend ``mediaUrls.ts``; change both."""
    assert derivative_key(key, "hero") == derivative


async def test_upload_source_file_sweeps_partial_triple_on_mid_flight_failure(
    tmp_path: Path, monkeypatch
):
    """A hero or thumb failure after the original landed sweeps the original and any
    derivative before the exception propagates (best effort), so the bucket never
    holds a partial triple."""
    from tests._fixtures import TINY_JPEG

    # Patch the class: ``get_storage`` builds a fresh backend per call.
    real_put = LocalStorage.put
    call_count = {"n": 0}

    async def flaky_put(self, body, key, content_type):
        call_count["n"] += 1
        # Call 1 is the original, call 2 the hero (fails).
        if call_count["n"] == 2:
            raise RuntimeError("simulated hero PUT failure")
        return await real_put(self, body, key, content_type)

    monkeypatch.setattr(LocalStorage, "put", flaky_put)

    file = upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    with pytest.raises(RuntimeError, match="simulated hero PUT failure"):
        await upload_source_file(file)

    uploads_dir = tmp_path / "uploads"
    leftovers = list(uploads_dir.iterdir()) if uploads_dir.exists() else []
    assert leftovers == [], (
        f"mid-flight sweep failed, partial upload left behind: {[p.name for p in leftovers]}"
    )


async def test_upload_proof_image_skips_derivatives(tmp_path: Path):
    """``upload_proof_image`` sets ``produce_derivatives=False``: proofs render the
    raw URL, so derivatives would be objects nothing fetches."""
    from app.services.storage import upload_proof_image
    from tests._fixtures import TINY_JPEG

    user_id = uuid4()
    file = upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    [(result, _)] = await upload_proof_image(file, user_id)

    assert result.derivative_keys == ()
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    assert (tmp_path / relative).exists()
    hero = tmp_path / derivative_key(relative, "hero")
    thumb = tmp_path / derivative_key(relative, "thumb")
    assert not hero.exists()
    assert not thumb.exists()


async def test_local_storage_round_trips_through_static_files_mount(tmp_path: Path):
    backend = LocalStorage(tmp_path)
    file = upload_file("evidence.jpg", b"served-bytes", "image/jpeg")
    await store(backend, file.file, "uploads/abc/evidence.jpg", "image/jpeg")

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

    assert [r.levelname for r in caplog.records].count("ERROR") == 1


def test_sweep_keys_swallows_unexpected_error_and_logs(tmp_path: Path, monkeypatch, caplog):
    """Transport failures (not ``StorageDeleteError``) are also swallowed and logged."""

    def _raise_runtime(self, keys: list[str]) -> None:
        raise RuntimeError("connection reset")

    monkeypatch.setattr(LocalStorage, "delete_many", _raise_runtime)
    with caplog.at_level("ERROR"):
        sweep_keys(["a.jpg", "b.jpg"], context="transport-failure test")

    assert [r.levelname for r in caplog.records].count("ERROR") == 1


def test_main_app_registers_local_storage_mount():
    from app.main import app

    paths = {getattr(route, "path", None) for route in app.routes}
    assert LOCAL_STORAGE_MOUNT_PATH in paths


# ── safe_original_filename ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "cleaned"),
    [
        # Empty or whitespace input keeps the column NULL.
        (None, None),
        ("", None),
        ("   ", None),
        # The multipart filename is attacker-controlled and lands on a public column, so
        # traversal and Windows-style paths are stripped to the basename.
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32", "system32"),
        ("/absolute/path/file.jpg", "file.jpg"),
        ("legit.jpg", "legit.jpg"),
        # ``Cc`` control and ``Cf`` format codepoints: the category check is the defence.
        ("evil\x00.jpg", None),
        ("split\nline.jpg", None),
        ("tab\there.jpg", None),
        ("esc\x1b.jpg", None),
        ("hide\u202eextn.jpg", None),
        ("ltr\u200emark.jpg", None),
        ("zwj\u200djoiner.jpg", None),
        ("bom\ufefftrick.jpg", None),
        ("iso\u2066late.jpg", None),
        # Escaping is the renderer's job: insert-time sanitising would corrupt ``&``.
        ("<img src=x>.jpg", "<img src=x>.jpg"),
        ("AT&T-logo.png", "AT&T-logo.png"),
        ('quote"name.png', 'quote"name.png'),
        # Path-shaped and HTML-shaped: the path strip runs first.
        ("<script>alert(1)</script>.jpg", "script>.jpg"),
    ],
)
def test_safe_original_filename(raw, cleaned):
    from app.services.storage import safe_original_filename

    assert safe_original_filename(raw) == cleaned


def test_safe_original_filename_caps_length():
    """Values past 255 chars (the NTFS / ext4 name max) are truncated."""
    from app.services.storage import ORIGINAL_FILENAME_MAX_LEN, safe_original_filename

    long_name = "a" * 500 + ".jpg"
    cleaned = safe_original_filename(long_name)
    assert cleaned is not None
    assert len(cleaned) == ORIGINAL_FILENAME_MAX_LEN
