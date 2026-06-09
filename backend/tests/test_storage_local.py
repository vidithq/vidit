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
    # SHA-256 of the exact bytes that landed on disk — verifiable
    # by anyone with the same file.
    assert result.sha256 == hashlib.sha256(b"fake-image-bytes").hexdigest()


async def test_local_storage_upload_bytes_writes_payload(tmp_path: Path):
    import hashlib

    backend = LocalStorage(tmp_path)

    result = await backend.upload_bytes(b"raw-bytes", "seed/demo/x.png", "image/png")

    assert (tmp_path / "seed" / "demo" / "x.png").read_bytes() == b"raw-bytes"
    assert result.url.endswith("/seed/demo/x.png")
    assert result.sha256 == hashlib.sha256(b"raw-bytes").hexdigest()


async def test_upload_file_helper_routes_through_local(tmp_path: Path):
    """``upload_file`` dispatches through the EXIF-strip pipeline for
    images, so the file that lands on disk is the *re-encoded* copy,
    not the raw bytes the client uploaded. We verify the hash matches
    what landed (not the input), which is the audit-relevant contract.
    """
    import hashlib

    from tests._fixtures import TINY_JPEG

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    result = await upload_file(file, geo_id)

    assert result.url.startswith(f"{LOCAL_STORAGE_URL_PREFIX}/uploads/{geo_id}/")
    assert result.url.endswith(".jpg")
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    on_disk = (tmp_path / relative).read_bytes()
    # Re-encoded (EXIF-stripped) JPEG is different from input bytes.
    assert on_disk != TINY_JPEG
    # The hash matches what physically landed — auditor-replayable.
    assert result.sha256 == hashlib.sha256(on_disk).hexdigest()


async def test_upload_file_writes_hero_and_thumbnail_derivatives(tmp_path: Path):
    """The image upload path lands three sibling objects: original,
    hero (max-dim 1280), thumbnail (max-dim 400). All three must
    physically exist on the storage backend after a successful upload.
    The structural-naming convention ``..._hero.jpg`` / ``..._thumb.jpg``
    is the source of truth shared with the frontend ``mediaUrls``
    helper, so a regression here breaks every detail-page / map-popup
    image render in the app.
    """
    from io import BytesIO as _BytesIO

    from PIL import Image as PILImage

    from tests._fixtures import TINY_JPEG

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")

    result = await upload_file(file, geo_id)

    original_relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    assert (tmp_path / original_relative).exists(), "original missing on disk"

    # Derivatives carry through on the result so the row-creation
    # cleanup path can sweep them on rollback.
    assert len(result.derivative_keys) == 2
    hero_key = derivative_key(original_relative, "hero")
    thumb_key = derivative_key(original_relative, "thumb")
    assert hero_key in result.derivative_keys
    assert thumb_key in result.derivative_keys

    # Both derivatives land on disk, both decode as JPEGs.
    hero_bytes = (tmp_path / hero_key).read_bytes()
    thumb_bytes = (tmp_path / thumb_key).read_bytes()
    assert PILImage.open(_BytesIO(hero_bytes)).format == "JPEG"
    assert PILImage.open(_BytesIO(thumb_bytes)).format == "JPEG"


async def test_upload_file_derives_extension_from_content_type_not_filename(tmp_path: Path):
    """The S3 key extension must come from the validated MIME type, NOT
    from the attacker-controlled ``file.filename``. A hostile filename
    can carry a 2000-char suffix, an RTL-override that disguises the
    apparent ext, or an extension that lies about the content type.
    """
    geo_id = uuid4()
    # Hostile filename: extension '.html' on a video/mp4 payload. The
    # validated content type wins.
    file = _upload_file("evil.html", b"fake-mp4-bytes", "video/mp4")

    result = await upload_file(file, geo_id)

    # ``.mp4`` is the canonical suffix for ``video/mp4``; this alone
    # proves the attacker-supplied ``.html`` didn't land in the key
    # (the assertion is exhaustive — UUID4 hex never contains ``html``).
    assert result.url.endswith(".mp4")


async def test_upload_file_skips_derivatives_for_video(tmp_path: Path):
    """Videos must not produce JPEG derivatives (first-frame extract
    is a separate slice). ``derivative_keys`` empty for video uploads
    so the caller doesn't sweep non-existent sibling keys on rollback.
    """
    # Minimal MP4 byte stream — the upload path only needs the
    # content-type to dispatch (the LocalStorage backend doesn't
    # actually decode the stream).
    geo_id = uuid4()
    file = _upload_file("clip.mp4", b"fake-mp4-bytes", "video/mp4")

    result = await upload_file(file, geo_id)
    assert result.derivative_keys == ()


def test_derivative_key_appends_suffix_and_forces_jpeg_extension():
    """The frontend mirrors this convention literally via string
    substitution in ``mediaUrls.ts``. Any change here must be
    matched there or the rendered ``<img src=...>`` 404s.
    """
    assert derivative_key("uploads/abc/xyz.jpg", "hero") == "uploads/abc/xyz_hero.jpg"
    assert derivative_key("uploads/abc/xyz.png", "thumb") == "uploads/abc/xyz_thumb.jpg"
    assert (
        derivative_key("demo-pool/geo-01/media/photo.webp", "hero")
        == "demo-pool/geo-01/media/photo_hero.jpg"
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
    """An S3 key without an extension shouldn't crash — the
    backend never produces these today but the helper should still
    be total. ``Path.with_suffix("")`` is a no-op so the suffix is
    appended cleanly and the ``.jpg`` extension is forced as usual.
    """
    assert derivative_key("uploads/abc/photo", "hero") == "uploads/abc/photo_hero.jpg"


async def test_upload_file_sweeps_partial_triple_on_mid_flight_failure(tmp_path: Path, monkeypatch):
    """If the hero or thumb upload fails after the original landed,
    the original (and any uploaded derivative) is best-effort swept
    before the exception propagates — so the bucket never holds an
    indexable original with no thumbnails (or vice versa). Locks in
    the storage-layer mid-flight cleanup contract.
    """
    from tests._fixtures import TINY_JPEG

    # Monkeypatch at the class level — ``get_storage`` constructs a
    # fresh backend on each call, so binding a flaky method to one
    # instance wouldn't propagate to the call inside
    # ``_upload_with_optional_strip``.
    real_upload_bytes = LocalStorage.upload_bytes
    call_count = {"n": 0}

    async def flaky_upload_bytes(self, data, key, content_type):
        call_count["n"] += 1
        # First call = original (landed). Second call = hero (fail).
        # Without the mid-flight sweep the original would orphan.
        if call_count["n"] == 2:
            raise RuntimeError("simulated hero PUT failure")
        return await real_upload_bytes(self, data, key, content_type)

    monkeypatch.setattr(LocalStorage, "upload_bytes", flaky_upload_bytes)

    geo_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    with pytest.raises(RuntimeError, match="simulated hero PUT failure"):
        await upload_file(file, geo_id)

    # Original was uploaded then swept — must not be on disk.
    geo_dir = tmp_path / "uploads" / str(geo_id)
    leftovers = list(geo_dir.iterdir()) if geo_dir.exists() else []
    assert leftovers == [], (
        f"mid-flight sweep failed — partial upload left behind: {[p.name for p in leftovers]}"
    )


async def test_upload_proof_image_skips_derivatives(tmp_path: Path):
    """Proof images route through ``upload_proof_image`` which
    sets ``produce_derivatives=False`` — inline proof rendering uses
    the raw storage URL via Tiptap, never the derivative path, so
    producing the JPEGs would write objects nothing ever fetches.
    Locks in that single-upload contract.
    """
    from app.services.storage import upload_proof_image
    from tests._fixtures import TINY_JPEG

    user_id = uuid4()
    file = _upload_file("photo.jpg", TINY_JPEG, "image/jpeg")
    result = await upload_proof_image(file, user_id)

    # The original lands on disk, derivatives don't.
    assert result.derivative_keys == ()
    relative = result.url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")
    assert (tmp_path / relative).exists()
    # Sibling _hero / _thumb keys NOT written.
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

    # b.jpg still there → parent dirs stay
    assert (tmp_path / "proof" / "u" / "b.jpg").exists()
    assert (tmp_path / "proof" / "u").exists()


# ── sweep_keys ────────────────────────────────────────────────────────────


def test_sweep_keys_empty_list_short_circuits(tmp_path: Path, monkeypatch):
    """Empty input must not even resolve ``get_storage()`` — callers reach
    sweep_keys on cleanup paths that should be a no-op when nothing landed."""
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
    """Per-key failures (StorageDeleteError) must not propagate — the caller
    already committed the DB side and a thrown sweep would turn settled state
    into a client-visible 500."""

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
    """Transport-level failures (network blip, auth) come up as something
    other than StorageDeleteError. sweep_keys must still swallow + log."""

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
    """Empty / whitespace input → ``None`` (column stays NULL)."""
    from app.services.storage import safe_original_filename

    assert safe_original_filename(None) is None
    assert safe_original_filename("") is None
    assert safe_original_filename("   ") is None


def test_safe_original_filename_strips_path_components():
    """Path traversal / Windows-style paths must be stripped to basename.

    The multipart filename field is attacker-controlled; an attacker
    can submit ``../../etc/passwd`` or ``..\\..\\windows\\system32``
    and the value lands on a public column. Strip to basename so the
    column never holds path-shaped strings that downstream renderers
    might interpret as URLs.
    """
    from app.services.storage import safe_original_filename

    assert safe_original_filename("../../etc/passwd") == "passwd"
    assert safe_original_filename("..\\..\\windows\\system32") == "system32"
    assert safe_original_filename("/absolute/path/file.jpg") == "file.jpg"
    assert safe_original_filename("legit.jpg") == "legit.jpg"


def test_safe_original_filename_rejects_control_and_format_codepoints():
    """Category-C codepoints (``Cc`` control + ``Cf`` format) → ``None``.

    Catches everything a legitimate filename never contains: NUL,
    newline, tab, ESC, U+202E (RTL override), U+200E (LTR mark),
    U+200B–D (zero-width joiners), U+2066–9 (bidi isolates), U+FEFF
    (BOM). The general ``unicodedata.category`` check is the
    primary defence — an earlier iteration enumerated specific
    codepoints and missed ZWJ / BOM / isolates.
    """
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
    """Values past 255 chars are truncated.

    255 is the common filesystem-name max (NTFS / ext4) and well
    above any real phone-camera filename. A 1 KB filename has no
    legitimate use case.
    """
    from app.services.storage import ORIGINAL_FILENAME_MAX_LEN, safe_original_filename

    long_name = "a" * 500 + ".jpg"
    cleaned = safe_original_filename(long_name)
    assert cleaned is not None
    assert len(cleaned) == ORIGINAL_FILENAME_MAX_LEN


def test_safe_original_filename_passes_through_html_shaped_strings():
    """HTML-shaped chars (without slashes) stay as-is — escaping is
    the renderer's job.

    Sanitising at insert would conflict with output-time escaping and
    silently corrupt legitimate filenames containing ``&`` etc. The
    insert-time defence is path-stripping + control-char rejection
    + length cap. Render-time defence is HTML-escape at the consumer.
    Both are needed; neither replaces the other.

    Note: a filename like ``<script>alert(1)</script>.jpg`` *would*
    get path-stripped at the ``/`` inside ``</script>`` — that's
    intentional; the multipart filename rarely contains a literal
    slash, and when it does we treat it as a path traversal attempt.
    The HTML-still-an-attack case is covered by render-time escaping.
    """
    from app.services.storage import safe_original_filename

    # No slashes → straight pass-through. The renderer is responsible
    # for HTML-escaping at output time.
    assert safe_original_filename("<img src=x>.jpg") == "<img src=x>.jpg"
    assert safe_original_filename("AT&T-logo.png") == "AT&T-logo.png"
    assert safe_original_filename('quote"name.png') == 'quote"name.png'


def test_safe_original_filename_path_strip_overrides_html_chars():
    """``</script>`` contains a ``/`` so the basename becomes the
    fragment after the slash — this is the correct, defensive behaviour.

    Locks in the (slightly surprising) interaction: a filename that's
    *both* path-shaped and HTML-shaped gets path-stripped first.
    """
    from app.services.storage import safe_original_filename

    assert safe_original_filename("<script>alert(1)</script>.jpg") == "script>.jpg"
