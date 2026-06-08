"""End-to-end tests for the demo seeder + admin /seed-demo endpoints.

The seeder shells out to `Storage.list_keys` to discover templates; in
tests we use `LocalStorage` and drop fixture files into a temp dir so
the discovery + URL-construction paths run for real.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.bounty import Bounty, BountyClaim
from app.models.geolocation import Geolocation
from app.models.user import User
from app.services import seed as seed_service
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_test_client_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def admin_user(db):
    user = User(
        username=f"adm{uuid.uuid4().hex[:8]}",
        email=f"admin-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def demo_pool(monkeypatch, tmp_path: Path):
    """Populate a fake demo-pool/ on a LocalStorage-backed temp dir.

    Forces the storage backend to local + points it at tmp_path so the
    test runs without S3. Drops two templates with two media + two proof
    images each.
    """
    monkeypatch.setattr(settings, "storage_backend", "local")
    monkeypatch.setattr(settings, "local_storage_dir", str(tmp_path))

    # Real (tiny) JPEG bytes so the seed's prep pass — which
    # re-decodes each pool image to compute sha256 and produce
    # hero/thumb derivatives — actually exercises the
    # ``make_jpeg_derivative`` path rather than falling on a "cannot
    # identify image file" error. ``TINY_JPEG`` is the same 1×1
    # fixture the upload tests use.
    from tests._fixtures import TINY_JPEG

    for template_id in ("geo-01", "geo-02"):
        for bucket in ("media", "proof"):
            d = tmp_path / "demo-pool" / template_id / bucket
            d.mkdir(parents=True, exist_ok=True)
            for i in (1, 2):
                (d / f"{i}.jpg").write_bytes(TINY_JPEG)

    yield tmp_path


@pytest.fixture(autouse=True)
def _wipe_demo_around_each(db):
    # Wipe BOTH before and after each test. Without the pre-yield wipe,
    # the first test in a `pytest -k <subset>` invocation inherits any
    # leftover demo rows from a previous (interrupted) seed and the
    # count assertions break. Symmetric pre/post keeps tests isolated
    # under any ordering.
    seed_service.wipe_demo_bounties(db)
    seed_service.wipe_demo(db)
    yield
    seed_service.wipe_demo_bounties(db)
    seed_service.wipe_demo(db)


def test_seed_demo_creates_geos_and_authors(db, demo_pool):
    result = seed_service.seed_demo(db, count=5)
    assert result["created"] == 5
    assert result["templates"] == 2
    assert result["authors"] == 5

    db.expire_all()
    demo_geos = db.query(Geolocation).filter(Geolocation.is_demo.is_(True)).all()
    assert len(demo_geos) == 5
    assert all(g.is_demo for g in demo_geos)
    assert all(g.media for g in demo_geos), "every demo geo should have at least one media row"
    assert all(g.proof and g.proof.get("type") == "doc" for g in demo_geos)

    # Every demo Media row now carries a sha256 — the seed's prep pass
    # hashes each unique pool key once and threads it into the
    # row constructor. Without this, demo data would be the only
    # remaining hash-less Media surface after PR 2 lands.
    for g in demo_geos:
        for m in g.media:
            assert m.sha256 is not None and len(m.sha256) == 64, (
                f"Demo Media row missing sha256: {m.id}"
            )

    # Title is generic — no region-specific copy that could leak past the
    # is_demo filter and read like a real claim.
    assert all(g.title == seed_service.DEMO_TITLE for g in demo_geos)

    # Every demo geo carries at least one tag (1–3 free + optional conflict).
    assert all(len(g.tags) >= 1 for g in demo_geos), (
        "every demo geo should pick at least one free tag"
    )

    demo_authors = db.query(User).filter(User.is_demo.is_(True)).all()
    assert len(demo_authors) == 5
    assert {a.username for a in demo_authors} == {f"demo-analyst-{i}" for i in range(1, 6)}


def test_seed_demo_writes_jpeg_derivatives_next_to_pool_originals(db, demo_pool):
    """Hero + thumbnail JPEGs land next to every pool image on first
    seed. Re-seed is a no-op on the derivative side (same key check)
    — verified by the cheap shortcut: a second ``seed_demo`` call
    over the same fixture keeps the same on-disk file list.
    """
    from pathlib import Path

    from PIL import Image as PILImage

    seed_service.seed_demo(db, count=3)
    pool_root = Path(demo_pool) / "demo-pool"

    # Every original key in the pool now has matching hero + thumb
    # siblings. Walk the fixture (2 templates × 2 media files = 4
    # originals → 8 derivatives).
    originals = sorted(pool_root.rglob("*.jpg"))
    originals = [p for p in originals if "/media/" in str(p)]
    derivatives = [p for p in originals if "_hero" in p.stem or "_thumb" in p.stem]
    pure_originals = [p for p in originals if p not in derivatives]
    assert len(pure_originals) == 4, "fixture should have 4 pool media originals"

    for original in pure_originals:
        hero = original.with_name(f"{original.stem}_hero.jpg")
        thumb = original.with_name(f"{original.stem}_thumb.jpg")
        assert hero.exists(), f"missing hero derivative for {original}"
        assert thumb.exists(), f"missing thumb derivative for {original}"
        # Both decode as JPEGs (catches a regression where the prep
        # pass uploads the raw original bytes instead of the
        # re-encoded derivative).
        assert PILImage.open(hero).format == "JPEG"
        assert PILImage.open(thumb).format == "JPEG"


def test_seed_demo_reseed_skips_existing_derivatives(db, demo_pool, caplog):
    """The second seed pass must not rewrite derivatives that are
    already in the pool. Re-encoding deterministic bytes would create
    fresh S3 object versions on every re-seed and accumulate version
    churn that Object Lock retains for 365 days — cheap but unbounded.

    Belt-and-braces assertion: mtime stability (could pass on a
    coarse-resolution filesystem if the rewrite happens within a
    second) **and** the prep-pass info log that announces non-zero
    derivative writes must be absent on the second seed.
    """
    import logging
    from pathlib import Path

    seed_service.seed_demo(db, count=3)
    pool_root = Path(demo_pool) / "demo-pool"
    hero_files = sorted(pool_root.rglob("*_hero.jpg"))
    # Snapshot mtimes after the first pass.
    first_mtimes = {h: h.stat().st_mtime_ns for h in hero_files}

    # A re-seed walks the same templates. The prep pass sees existing
    # derivatives in ``list_keys`` and skips them — so the file
    # mtimes shouldn't change, *and* the "wrote N derivative
    # object(s)" log line shouldn't fire.
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="app.services.seed"):
        seed_service.seed_demo(db, count=3)
    second_mtimes = {h: h.stat().st_mtime_ns for h in hero_files}
    assert first_mtimes == second_mtimes, "re-seed should not rewrite already-existing derivatives"
    derivative_log_lines = [r.message for r in caplog.records if "Demo pool prep:" in r.message]
    assert derivative_log_lines == [], (
        f"re-seed wrote derivatives that should have been skipped: {derivative_log_lines}"
    )


def test_seed_demo_half_completed_prior_seed_only_fills_the_gap(db, demo_pool):
    """If a prior crashed seed wrote ``_hero`` but not ``_thumb`` for
    a given pool key, the next seed must produce *only* the missing
    thumb — the already-present hero stays at its original mtime.

    Earlier the shortcut was ``if hero in existing and thumb in
    existing: continue``, which re-derived both whenever either was
    missing — re-versioning the present derivative on the bucket
    under Object Lock retention.
    """
    import time
    from pathlib import Path

    seed_service.seed_demo(db, count=2)
    pool_root = Path(demo_pool) / "demo-pool"
    hero_files = sorted(pool_root.rglob("*_hero.jpg"))
    assert hero_files, "first seed should have produced hero derivatives"

    # Simulate a half-completed prior seed: delete every thumb
    # derivative but leave the heroes in place.
    thumb_files = sorted(pool_root.rglob("*_thumb.jpg"))
    for t in thumb_files:
        t.unlink()
    hero_mtimes_before = {h: h.stat().st_mtime_ns for h in hero_files}
    time.sleep(0.01)  # filesystem mtime granularity

    # Wipe demo rows + re-seed. Prep pass should ONLY write the
    # missing thumbs back; hero mtimes must stay the same.
    seed_service.wipe_demo(db)
    seed_service.seed_demo(db, count=2)
    hero_mtimes_after = {h: h.stat().st_mtime_ns for h in hero_files}
    assert hero_mtimes_before == hero_mtimes_after, (
        "present hero should not be re-derived when only thumb is missing"
    )
    assert all((pool_root / t.relative_to(pool_root)).exists() for t in thumb_files), (
        "missing thumbs should be regenerated"
    )


def test_seed_demo_picks_tags_from_known_pool(db, demo_pool):
    """Assigned tags must come from the documented free + conflict +
    capture-source pools (plus the always-attached `demo` tag).

    Catches a regression where a typo in CONFLICT_TAG_BY_REGION,
    FREE_TAG_POOL, or CAPTURE_SOURCE_TAGS would silently start minting
    tag rows the filter UI doesn't know about. Run with a larger sample
    so we're likely to hit a Ukraine/Middle East region and exercise the
    conflict-tag branch.
    """
    seed_service.seed_demo(db, count=50)
    db.expire_all()
    allowed_names = (
        {seed_service.DEMO_TAG_NAME, seed_service.CONFLICT_OTHER_TAG}
        | set(seed_service.FREE_TAG_POOL)
        | set(seed_service.CONFLICT_TAG_BY_REGION.values())
        | set(seed_service.CAPTURE_SOURCE_TAGS)
    )
    geos = db.query(Geolocation).filter(Geolocation.is_demo.is_(True)).all()
    seen_names = {tag.name for g in geos for tag in g.tags}
    assert seen_names, "expected at least one tag across 50 seeded geos"
    assert seen_names.issubset(allowed_names), (
        f"unexpected tags surfaced: {seen_names - allowed_names}"
    )
    # Every demo geo should carry the `demo` filter tag.
    assert all(any(t.name == seed_service.DEMO_TAG_NAME for t in g.tags) for g in geos), (
        "every demo geo must carry the always-on `demo` tag"
    )
    # New invariant: every demo geo carries exactly one capture_source
    # tag and at least one conflict tag (the region's, or "Other") —
    # mirrors the required-category rule the submit form enforces.
    capture_set = set(seed_service.CAPTURE_SOURCE_TAGS)
    conflict_set = set(seed_service.CONFLICT_TAG_BY_REGION.values()) | {
        seed_service.CONFLICT_OTHER_TAG
    }
    for g in geos:
        names = [t.name for t in g.tags]
        assert sum(n in capture_set for n in names) == 1, (
            f"geo should carry exactly one capture_source tag, got {names}"
        )
        assert any(n in conflict_set for n in names), (
            f"geo should carry a conflict tag, got {names}"
        )


def test_seed_demo_idempotent_on_authors(db, demo_pool):
    seed_service.seed_demo(db, count=2)
    first_ids = {a.id for a in db.query(User).filter(User.is_demo.is_(True)).all()}
    seed_service.seed_demo(db, count=2)
    db.expire_all()
    second_ids = {a.id for a in db.query(User).filter(User.is_demo.is_(True)).all()}
    assert first_ids == second_ids, "demo authors must be reused across seed calls"


def test_seed_demo_raises_when_pool_empty(db, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "storage_backend", "local")
    monkeypatch.setattr(settings, "local_storage_dir", str(tmp_path))
    # tmp_path has no demo-pool/ subtree
    with pytest.raises(seed_service.NoTemplatesError):
        seed_service.seed_demo(db, count=1)


@pytest.mark.parametrize(
    "count",
    [9, 10, 11, 20, 21],
    ids=["just-under-batch", "exact-batch", "just-over-batch", "exact-2x-batch", "2x-plus-one"],
)
def test_seed_demo_handles_batch_boundaries(db, demo_pool, monkeypatch, count):
    """Exercise the per-batch flush logic at off-by-one boundaries.

    The seeder commits in `SEED_BATCH_SIZE` chunks; if the boundary
    handling is wrong, tag-link rows from the *last* partial batch
    (or the last full batch with no tail) would silently drop. Test
    every count near a multiple of the batch size with a tiny batch
    so it's fast.
    """
    monkeypatch.setattr(seed_service, "SEED_BATCH_SIZE", 10)
    result = seed_service.seed_demo(db, count=count)
    assert result["created"] == count

    db.expire_all()
    geos = db.query(Geolocation).filter(Geolocation.is_demo.is_(True)).all()
    assert len(geos) == count
    # Every geo should have at least one tag — proves the M2M flush
    # didn't drop the last batch's links.
    assert all(len(g.tags) >= 1 for g in geos), (
        f"some geos lost their tag links at count={count} — batch-boundary regression"
    )


def test_wipe_demo_drops_demo_geos_and_users(db, demo_pool):
    seed_service.seed_demo(db, count=3)
    result = seed_service.wipe_demo(db)
    assert result["deleted_geos"] == 3
    assert result["deleted_users"] == 5

    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.is_demo.is_(True)).count() == 0
    assert db.query(User).filter(User.is_demo.is_(True)).count() == 0


def test_seed_demo_endpoint_for_admin(admin_user, demo_pool, db):
    response = client.post(
        "/api/v1/admin/seed-demo",
        json={"count": 3},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 3
    assert body["templates"] == 2

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "demo_seeded",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"count": 3, "templates": 2}


def test_seed_demo_endpoint_403_for_regular_user(db, demo_pool):
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"u-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add(user)
    db.commit()
    try:
        response = client.post(
            "/api/v1/admin/seed-demo",
            json={"count": 1},
            headers=login_as(client, user),
        )
        assert response.status_code == 403
    finally:
        db.delete(user)
        db.commit()


def test_seed_demo_endpoint_422_when_pool_empty(admin_user, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "storage_backend", "local")
    monkeypatch.setattr(settings, "local_storage_dir", str(tmp_path))
    response = client.post(
        "/api/v1/admin/seed-demo",
        json={"count": 1},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422
    assert "demo-pool" in response.json()["detail"].lower()


def test_wipe_demo_endpoint_for_admin(admin_user, demo_pool, db):
    seed_service.seed_demo(db, count=2)
    response = client.delete(
        "/api/v1/admin/seed-demo",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["deleted_geos"] == 2
    assert body["deleted_users"] == 5


# ── Bounty seeder ────────────────────────────────────────────────────────


def test_seed_demo_bounties_creates_bounties_with_media(db, demo_pool):
    result = seed_service.seed_demo_bounties(db, count=4)
    assert result["created"] == 4
    assert result["templates"] == 2
    assert result["authors"] == 5
    # Per-status breakdown sums to the requested count (sanity-check the
    # weighted sampler — see ``DEMO_BOUNTY_STATUS_WEIGHTS``).
    assert result["open"] + result["fulfilled"] + result["closed"] == 4

    bounties = db.query(Bounty).filter(Bounty.is_demo.is_(True)).all()
    assert len(bounties) == 4
    for b in bounties:
        # The seeder spreads bounties across the lifecycle; any of the
        # three statuses is valid output.
        assert b.status in {"open", "fulfilled", "closed"}
        # Open and closed bounties keep their media; fulfilled bounties
        # transfer it to the paired geolocation (mirroring real
        # fulfilment), so the bounty ends up with zero media rows.
        if b.status in {"open", "closed"}:
            assert len(b.media) >= 1
        else:
            assert len(b.media) == 0
        # The always-on `demo` free tag for filter-chip scoping is
        # attached to every bounty regardless of status.
        tag_names = {t.name for t in b.tags}
        assert "demo" in tag_names

    # Every fulfilled bounty carries a paired demo geolocation with the
    # ``originated_from_bounty_id`` trace pointing back — that's the
    # entire reason we seed fulfilled rows (status filter + trace banner
    # coverage). At-least-one assertion would be lenient; the exact
    # match is fine because the seeder mints them deterministically.
    paired_geos = (
        db.query(Geolocation)
        .filter(
            Geolocation.is_demo.is_(True),
            Geolocation.originated_from_bounty_id.in_([b.id for b in bounties]),
        )
        .count()
    )
    assert paired_geos == result["fulfilled"]


def test_seed_demo_bounties_attaches_some_claims(db, demo_pool):
    """The seeder optionally attaches claims so the multi-claimer UI has
    something to render. With a large enough count the probability of
    at least one bounty getting a claim is overwhelming."""
    seed_service.seed_demo_bounties(db, count=20)
    claim_count = db.query(BountyClaim).count()
    assert claim_count > 0


def test_wipe_demo_bounties_only_drops_demo_rows(db, demo_pool, admin_user):
    """The bounty wipe must NOT touch demo users or demo geolocations —
    they're behind the separate panel and an admin may want to keep
    one population while wiping the other. The bounty seeder also
    mints paired demo geos for fulfilled bounties (status-filter
    coverage); those survive the bounty wipe with their
    ``originated_from_bounty_id`` flipped to NULL via the FK's ON
    DELETE SET NULL.
    """
    seed_service.seed_demo(db, count=3)  # creates demo authors + 3 demo geos
    bounty_result = seed_service.seed_demo_bounties(db, count=4)
    expected_demo_geos = 3 + bounty_result["fulfilled"]

    result = seed_service.wipe_demo_bounties(db)
    assert result["deleted_bounties"] == 4
    db.expire_all()
    # Bounties gone, demo authors + demo geos intact.
    assert db.query(Bounty).filter(Bounty.is_demo.is_(True)).count() == 0
    assert db.query(Geolocation).filter(Geolocation.is_demo.is_(True)).count() == expected_demo_geos
    assert db.query(User).filter(User.is_demo.is_(True)).count() == 5


def test_seed_demo_bounties_endpoint_for_admin(admin_user, demo_pool, db):
    response = client.post(
        "/api/v1/admin/seed-demo-bounties",
        json={"count": 3},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 3
    assert body["templates"] == 2

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "demo_bounties_seeded",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"count": 3, "templates": 2}


def test_seed_demo_bounties_endpoint_403_for_regular_user(db, demo_pool):
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"u-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add(user)
    db.commit()
    try:
        response = client.post(
            "/api/v1/admin/seed-demo-bounties",
            json={"count": 1},
            headers=login_as(client, user),
        )
        assert response.status_code == 403
    finally:
        db.delete(user)
        db.commit()


def test_seed_demo_bounties_endpoint_422_when_pool_empty(admin_user, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "storage_backend", "local")
    monkeypatch.setattr(settings, "local_storage_dir", str(tmp_path))
    response = client.post(
        "/api/v1/admin/seed-demo-bounties",
        json={"count": 1},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422
    assert "demo-pool" in response.json()["detail"].lower()


def test_wipe_demo_bounties_endpoint_for_admin(admin_user, demo_pool, db):
    seed_service.seed_demo_bounties(db, count=2)
    response = client.delete(
        "/api/v1/admin/seed-demo-bounties",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["deleted_bounties"] == 2
