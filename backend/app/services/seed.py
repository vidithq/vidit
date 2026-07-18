"""Demo-data seeder for the admin "Demo data" panel.

Creates synthetic geolocations attributed to a fixed pool of demo authors
(`is_demo=True`), with media + proof imagery referenced from a curated S3
prefix (`demo-pool/`) an admin populates outside the codebase. No real
content ever has `is_demo=True`, so wipe is a single bulk DELETE.

Pool layout the seeder expects (admin populates once):

    demo-pool/
      geo-01/
        media/  ← gallery photos (1–4 files)
        proof/  ← photos embedded in the proof body (1–4 files)
      geo-02/
        ...
      geo-N/

Generated geos *reference* the pool keys via Storage.public_url — they
don't copy bytes, so 1000 demo geos over 10 templates cost 10 S3 keys and
wiping is just a DB drop.
"""

from __future__ import annotations

import hashlib
import logging
import math
import random
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.conflict import Conflict, event_conflicts
from app.models.event import (
    STATUS_CLOSED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
    EventInvestigator,
    EventStatus,
)
from app.models.media import Media
from app.models.tag import Tag, event_tags
from app.models.user import User
from app.services import social
from app.services.auth import hash_password
from app.services.evidence_processing import (
    HERO_MAX_DIM,
    THUMBNAIL_MAX_DIM,
    make_jpeg_derivative,
)
from app.services.sanitize import sanitize_tiptap_doc
from app.services.storage import Storage, derivative_key, get_storage

logger = logging.getLogger(__name__)


# ── Demo population fixtures ─────────────────────────────────────────────

DEMO_POOL_PREFIX = "demo-pool/"

# Five fixed demo accounts, created on first seed and reused. The
# `.invalid` TLD (RFC 2606) is guaranteed non-deliverable, so even if
# `email.send` ran against one it would fail safely.
DEMO_AUTHORS: list[dict[str, Any]] = [
    {
        "username": "demo-analyst-1",
        "email": "demo-analyst-1@vidit.invalid",
        "is_trusted": True,
        "trust_reason": "Demo account: established OSINT presence (synthetic).",
    },
    {
        "username": "demo-analyst-2",
        "email": "demo-analyst-2@vidit.invalid",
        "is_trusted": False,
        "trust_reason": None,
    },
    {
        "username": "demo-analyst-3",
        "email": "demo-analyst-3@vidit.invalid",
        "is_trusted": True,
        "trust_reason": "Demo account: long-standing contributor (synthetic).",
    },
    {
        "username": "demo-analyst-4",
        "email": "demo-analyst-4@vidit.invalid",
        "is_trusted": False,
        "trust_reason": None,
    },
    {
        "username": "demo-analyst-5",
        "email": "demo-analyst-5@vidit.invalid",
        "is_trusted": False,
        "trust_reason": None,
    },
]

# Region bounding boxes. Ukraine + Middle East are the bulk (active
# conflict zones for an OSINT platform); the rest add geographic variety so
# map clustering, search, and the timeline read as global. Weights are
# integer percentages summing to 100 (Ukraine + Middle East = 70).
REGIONS: list[dict[str, Any]] = [
    {
        "name": "Ukraine",
        "weight": 50,
        "lat": (44.0, 52.0),
        "lon": (22.0, 40.0),
    },
    {
        "name": "Middle East",
        "weight": 20,
        "lat": (30.0, 37.0),
        "lon": (35.0, 46.0),
    },
    {
        "name": "Sahel",
        "weight": 8,
        "lat": (12.0, 20.0),
        "lon": (-12.0, 16.0),
    },
    {
        "name": "Western Europe",
        "weight": 7,
        "lat": (41.0, 55.0),
        "lon": (-9.0, 15.0),
    },
    {
        "name": "Balkans",
        "weight": 4,
        "lat": (39.0, 46.0),
        "lon": (14.0, 28.0),
    },
    {
        "name": "North America",
        "weight": 4,
        "lat": (25.0, 49.0),
        "lon": (-125.0, -67.0),
    },
    {
        "name": "South America",
        "weight": 3,
        "lat": (-35.0, 10.0),
        "lon": (-75.0, -35.0),
    },
    {
        "name": "East Asia",
        "weight": 2,
        "lat": (20.0, 45.0),
        "lon": (100.0, 145.0),
    },
    {
        "name": "Sub-Saharan Africa",
        "weight": 2,
        "lat": (-30.0, 0.0),
        "lon": (12.0, 40.0),
    },
]

# All demo geos share one generic title — a synthetic row shouldn't
# pretend to know a real place; the UI's "DEMO" badge carries the signal.
DEMO_TITLE = "Demo geolocation"
DEMO_PROOF_TEXT = (
    "This is a synthetic demo entry. Imagery is sampled from a curated demo "
    "pool; coordinates, author, and event date are randomly generated."
)

# Hotspots = approximate city / area centres to cluster points around, so
# the map reads conflict-shaped rather than a uniform bbox smear. Jitter is
# the spread radius in km (converted to lat/lon degrees on the fly).
# Regions without hotspots fall back to bbox-uniform.
HOTSPOTS_BY_REGION: dict[str, list[tuple[str, float, float, float]]] = {
    "Ukraine": [
        ("Kyiv", 50.45, 30.52, 25),
        ("Kharkiv", 49.99, 36.23, 25),
        ("Donetsk", 48.00, 37.80, 30),
        ("Mariupol", 47.10, 37.55, 20),
        ("Bakhmut", 48.59, 37.99, 15),
        ("Avdiivka", 48.14, 37.74, 10),
        ("Mykolaiv", 46.97, 31.99, 20),
        ("Odesa", 46.48, 30.73, 25),
        ("Kherson", 46.64, 32.62, 20),
        ("Zaporizhzhia", 47.84, 35.14, 25),
        ("Lviv", 49.84, 24.03, 20),
        ("Sumy", 50.91, 34.80, 20),
    ],
    "Middle East": [
        ("Gaza", 31.50, 34.46, 12),
        ("Beirut", 33.89, 35.50, 18),
        ("Damascus", 33.51, 36.29, 22),
        ("Aleppo", 36.20, 37.16, 22),
        ("Mosul", 36.34, 43.13, 20),
        ("Baghdad", 33.32, 44.36, 22),
        ("Sanaa", 15.37, 44.19, 20),
        ("Hodeidah", 14.79, 42.95, 18),
        ("Tel Aviv", 32.07, 34.78, 15),
    ],
    "Sahel": [
        ("Bamako", 12.64, -8.00, 25),
        ("Niamey", 13.51, 2.11, 25),
        ("Ouagadougou", 12.37, -1.52, 25),
        ("N'Djamena", 12.13, 15.05, 25),
        ("Timbuktu", 16.77, -3.01, 18),
    ],
    "Western Europe": [
        ("Paris", 48.86, 2.35, 30),
        ("Berlin", 52.52, 13.40, 30),
        ("Madrid", 40.42, -3.70, 30),
        ("Rome", 41.90, 12.50, 25),
        ("London", 51.51, -0.13, 30),
    ],
    "Balkans": [
        ("Sarajevo", 43.86, 18.41, 20),
        ("Belgrade", 44.79, 20.46, 22),
        ("Pristina", 42.66, 21.17, 18),
        ("Skopje", 41.99, 21.43, 18),
    ],
    "North America": [
        ("Washington DC", 38.91, -77.04, 35),
        ("New York", 40.71, -74.00, 35),
        ("Los Angeles", 34.05, -118.24, 35),
        ("Chicago", 41.88, -87.63, 30),
    ],
    "South America": [
        ("Bogotá", 4.71, -74.07, 25),
        ("Caracas", 10.48, -66.90, 25),
        ("Buenos Aires", -34.61, -58.38, 30),
        ("Lima", -12.05, -77.04, 25),
    ],
    "East Asia": [
        ("Tokyo", 35.68, 139.69, 35),
        ("Seoul", 37.57, 126.98, 30),
        ("Manila", 14.60, 120.98, 25),
        ("Bangkok", 13.76, 100.50, 25),
    ],
    "Sub-Saharan Africa": [
        ("Lagos", 6.52, 3.38, 30),
        ("Nairobi", -1.29, 36.82, 25),
        ("Kinshasa", -4.32, 15.31, 30),
        ("Johannesburg", -26.20, 28.05, 25),
    ],
}

# Probability a point anchors on a hotspot vs. bbox-uniform. Higher =
# tighter clustering; lower = more even background coverage.
HOTSPOT_PROBABILITY = 0.85

# Conflicts by region, rows in the `conflicts` referential (the seeder
# creates them if absent, as `source='manual'`). Regions not listed fall
# back to the `Other` escape conflict. Values are the exact Wikipedia
# article titles so a later sync adopts the rows instead of forking
# duplicates.
CONFLICT_BY_REGION: dict[str, str] = {
    "Ukraine": "Russo-Ukrainian War",
    "Middle East": "Gaza war",
}

# Attached to every demo geo so one filter-chip click scopes to (or
# excludes) the synthetic set without the viewer knowing about `is_demo`.
DEMO_TAG_NAME = "demo"

# Free tags on demo geos to exercise multi-tag filter combinations — a mix
# of OSINT-genre keywords the analyst community uses.
FREE_TAG_POOL: list[str] = [
    "armor",
    "artillery",
    "airstrike",
    "drone strike",
    "infrastructure",
    "urban",
    "naval",
    "civilian",
    "vehicle",
    "depot",
    "checkpoint",
]

# Capture-source taxonomy — the curated `capture_source` category seeded in
# prod by migration `s5n7p9r1t3v5`. Mirrored so the seeder attaches one to
# every geo (a required submit-form selector), which also makes the
# capture-source map filter demoable on a fresh DB. Keep in sync with the
# migration.
CAPTURE_SOURCE_TAGS: list[str] = [
    "Smartphone",
    "Satellite",
    "Drone",
    "Static camera",
    "Dashcam",
    "Body / helmet cam",
    "Unknown",
]

# Conflict escape value (seeded in prod by migration `j2l4n6p8r0t2`). Demo
# geos in regions with no mapped conflict get this, so every row satisfies
# the "one conflict per geo" intent and the "Other" chip is exercised.
CONFLICT_OTHER_NAME = "Other"


# ── Helpers ──────────────────────────────────────────────────────────────


# Pinned at import: one bcrypt of a sentinel that can't match any
# user-supplied password. Reused across all demo accounts — one bcrypt per
# process, not per seed call.
_DEMO_UNLOGGABLE_HASH = hash_password("!demo-no-login!")


def _ensure_demo_authors(db: Session) -> list[User]:
    """Create the 5 demo accounts if absent; return all 5.

    Race-safe via `INSERT ... ON CONFLICT (username) DO NOTHING`: two
    concurrent admin clicks used to crash the loser on the
    `users.username` UNIQUE; now the loser is a silent no-op and the
    follow-up SELECT picks up the winner's row.
    """
    rows = [
        {
            "username": spec["username"],
            "email": spec["email"],
            "password_hash": _DEMO_UNLOGGABLE_HASH,
            "is_demo": True,
            "is_trusted": spec["is_trusted"],
            "trust_reason": spec["trust_reason"],
        }
        for spec in DEMO_AUTHORS
    ]
    db.execute(pg_insert(User).values(rows).on_conflict_do_nothing(index_elements=["username"]))
    db.flush()
    return (
        db.query(User).filter(User.username.in_([spec["username"] for spec in DEMO_AUTHORS])).all()
    )


def _discover_templates() -> dict[str, dict[str, list[str]]]:
    """Walk `demo-pool/` and group keys by template + bucket.

    Returns `{template_id: {"media": [keys], "proof": [keys]}}`. Templates
    without at least one media file are skipped — they wouldn't render.

    Filters out derivative sidecars (``*_hero.jpg`` / ``*_thumb.jpg``) that
    ``_prepare_pool_media`` writes alongside each original under the same
    ``media/`` prefix. Letting them through would (a) sample derivatives
    into Media rows as originals and (b) recursively derive
    ``*_hero_hero.jpg`` chains on each subsequent seed.
    """
    storage = get_storage()
    keys = storage.list_keys(DEMO_POOL_PREFIX)
    grouped: dict[str, dict[str, list[str]]] = defaultdict(lambda: {"media": [], "proof": []})
    for key in keys:
        # Expected: demo-pool/geo-XX/{media,proof}/<filename>
        rest = key[len(DEMO_POOL_PREFIX) :]
        parts = rest.split("/")
        if len(parts) < 3:
            continue
        template_id, bucket = parts[0], parts[1]
        if bucket not in ("media", "proof"):
            continue
        # Drop derivative sidecars (see docstring).
        filename = parts[-1]
        stem = filename.rsplit(".", 1)[0] if "." in filename else filename
        if stem.endswith("_hero") or stem.endswith("_thumb"):
            continue
        grouped[template_id][bucket].append(key)

    return {
        tid: buckets
        for tid, buckets in grouped.items()
        if buckets["media"]  # at least one media key required
    }


def _pick_region() -> dict[str, Any]:
    weights = [r["weight"] for r in REGIONS]
    return random.choices(REGIONS, weights=weights, k=1)[0]


def _bbox_random_point(region: dict[str, Any]) -> tuple[float, float]:
    lat = random.uniform(*region["lat"])
    lon = random.uniform(*region["lon"])
    return lat, lon


def _hotspot_random_point(
    hotspot: tuple[str, float, float, float],
) -> tuple[float, float]:
    """Jittered point around a city centre — 2D Gaussian, not uniform square.

    `random.uniform(-spread, +spread)` produced visible square boundaries
    at high dot counts. A Gaussian with `sigma = jitter / 2.5` puts ~95 % of
    points inside `±jitter` with a natural edge fade; nearby hotspots' tails
    overlap so the corridor between cities fills in organically. Longitude
    is `cos(lat)`-scaled so the same km-sigma is geometrically circular at
    any latitude.
    """
    _name, lat, lon, jitter_km = hotspot
    sigma_lat = (jitter_km / 2.5) / 111.0
    # cos guard against +/- 90° corner cases
    cos_lat = max(0.05, math.cos(math.radians(lat)))
    sigma_lon = (jitter_km / 2.5) / (111.0 * cos_lat)
    return (
        lat + random.gauss(0, sigma_lat),
        lon + random.gauss(0, sigma_lon),
    )


def _pick_point_for(region: dict[str, Any]) -> tuple[float, float]:
    """Pick a point inside `region` — clustered around hotspots when present,
    else bbox-uniform. The 15% bbox-uniform tail (when hotspots exist) gives
    the map a believable background scatter instead of every point on a pin."""
    hotspots = HOTSPOTS_BY_REGION.get(region["name"], [])
    if hotspots and random.random() < HOTSPOT_PROBABILITY:
        return _hotspot_random_point(random.choice(hotspots))
    return _bbox_random_point(region)


def _random_event_date() -> date:
    days_back = random.randint(0, 365)
    return (datetime.now(UTC) - timedelta(days=days_back)).date()


def _random_source_posted_at(event_date: date) -> datetime:
    """Demo source post instant: the event day at a random UTC time. Real rows
    carry the analyst's entered time or the imported tweet's timestamp."""
    return datetime.combine(
        event_date, time(random.randint(0, 23), random.randint(0, 59)), tzinfo=UTC
    )


def _media_type_from_key(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    if ext in ("mp4", "webm", "mov"):
        return "video"
    return "image"


# Map a pool key's extension to a content type for the evidence layer.
# ``make_jpeg_derivative`` only checks it for the no-op gate (videos pass
# through); the right MIME keeps the helper composable with future strip /
# derivative logic.
_IMAGE_CONTENT_TYPE_BY_EXT: dict[str, str] = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def _image_content_type_from_key(key: str) -> str | None:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return _IMAGE_CONTENT_TYPE_BY_EXT.get(ext)


def _prepare_pool_media(
    templates: dict[str, dict[str, list[str]]],
    storage: Storage,
) -> dict[str, str]:
    """Hash every pool key + produce derivatives where source images miss them.

    For each unique key referenced by `templates` (both buckets: ``media``
    becomes the source row, ``proof`` the proof rows):

    1. Download the original bytes. **Runs once per seed invocation, not
       once per pool lifetime** — the sha256 isn't cached on the bucket, so
       every call re-downloads the pool to recompute it (~100s of S3 GETs,
       seconds at current scale). If the pool grows, cache the sha256 in a
       sibling object.
    2. Compute the sha256 hex so the row constructor sets ``Media.sha256``,
       matching the evidence-integrity contract real uploads honour.
    3. For ``media``-bucket images, generate JPEG hero + thumbnail derivatives
       at the sibling keys, skipped if already present. Skipping matters: a
       re-seed would otherwise rewrite identical bytes, which the bucket's
       Object Lock + versioning turns into unbounded version churn. Proof
       keys get no derivatives (inline proof images render from the raw URL,
       same as real uploads).

    Videos: hashed for the row, no derivatives (no first-frame extraction).

    Returns ``{pool_key: sha256_hex}`` across both buckets.

    Failure handling (both partial-success, neither aborts the seed): a
    per-key ``get_bytes`` miss is logged + skipped (the row lands with
    ``sha256=NULL`` and a ``storage_url`` pointing at the missing original,
    404ing on the detail page); a per-derivative ``put_bytes_sync`` failure
    is logged + skipped (sha256 still lands — computed pre-upload — but the
    frontend 404s on the hero/thumb until the next seed).
    """
    unique_media_keys: set[str] = set()
    unique_proof_keys: set[str] = set()
    for template in templates.values():
        unique_media_keys.update(template["media"])
        unique_proof_keys.update(template["proof"])

    # One list_keys call up front to pick up derivatives from a prior seed
    # run. (``_discover_templates`` already paid this once; the re-list is
    # cheap — size is bounded by the pool, ~100s of keys.)
    existing_keys = set(storage.list_keys(DEMO_POOL_PREFIX))

    sha256_by_key: dict[str, str] = {}
    derivatives_written = 0
    for key in sorted(unique_media_keys | unique_proof_keys):
        try:
            data = storage.get_bytes(key)
        except Exception:
            # The pool list included this key, so a miss is surprising —
            # likely an admin partial-delete between list and get, or S3
            # eventual consistency. Filtering the templates dict to fix it
            # would be more invasive (also needs empty-template filtering);
            # log loudly and move on. The downstream row references the
            # missing original and 404s; re-seed to recover.
            logger.warning(
                "Could not read pool key %s; row referencing this key "
                "will have NULL sha256 and 404 on detail page until "
                "the next seed pass",
                key,
            )
            continue
        sha256_by_key[key] = hashlib.sha256(data).hexdigest()

        if key in unique_proof_keys:
            # Proof images render from the raw URL: hash only, no derivatives.
            continue
        content_type = _image_content_type_from_key(key)
        if content_type is None:
            # Videos — hash the row, skip derivatives (no first-frame extract).
            continue

        hero_key = derivative_key(key, "hero")
        thumb_key = derivative_key(key, "thumb")
        hero_present = hero_key in existing_keys
        thumb_present = thumb_key in existing_keys
        # Re-seed shortcut: present derivatives stay put. The encoder is
        # deterministic, so rewriting identical bytes is noise on a
        # versioned + Object-Locked bucket. Checked independently so a
        # half-completed prior seed only re-derives the missing half.
        if hero_present and thumb_present:
            continue

        # Per-derivative try/except so a transient ``put_bytes_sync``
        # failure on one key doesn't abort the prep pass. The sha256 already
        # landed (pre-upload), so the row stays well-formed; the next seed
        # picks up the missing derivative via the existence check.
        if not hero_present:
            try:
                hero = make_jpeg_derivative(data, content_type, HERO_MAX_DIM)
                storage.put_bytes_sync(hero, hero_key, "image/jpeg")
                derivatives_written += 1
            except Exception:
                logger.warning(
                    "Failed to derive/upload hero for pool key %s; "
                    "frontend will 404 on its _hero.jpg until next seed",
                    key,
                )
        if not thumb_present:
            try:
                thumb = make_jpeg_derivative(data, content_type, THUMBNAIL_MAX_DIM)
                storage.put_bytes_sync(thumb, thumb_key, "image/jpeg")
                derivatives_written += 1
            except Exception:
                logger.warning(
                    "Failed to derive/upload thumb for pool key %s; "
                    "frontend will 404 on its _thumb.jpg until next seed",
                    key,
                )

    if derivatives_written:
        logger.info(
            "Demo pool prep: wrote %d derivative object(s) across %d media key(s)",
            derivatives_written,
            len(unique_media_keys),
        )
    return sha256_by_key


def _build_proof(image_keys: list[str]) -> dict[str, Any]:
    """Build a Tiptap JSON document with a generic body + image nodes.

    Copy is content-free — no place names or event details that could read
    as a real claim if the row leaked past the `is_demo` filter. Image
    `src` values point at the CloudFront URL (or local-storage in dev) so
    the sanitiser allows them through unchanged.
    """
    storage = get_storage()
    nodes: list[dict[str, Any]] = [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": DEMO_PROOF_TEXT}],
        }
    ]
    for key in image_keys:
        nodes.append(
            {
                "type": "image",
                "attrs": {
                    "src": storage.public_url(key),
                    "alt": "Demo proof image",
                },
            }
        )
    return {"type": "doc", "content": nodes}


def _ensure_tags(db: Session) -> dict[str, Tag]:
    """Create the tag rows the seeder uses if absent; return them keyed by name.

    Race-safe via `INSERT ... ON CONFLICT (name) DO NOTHING` — concurrent
    admin clicks racing on the `tags.name` UNIQUE don't crash the loser;
    the follow-up SELECT picks up whichever row landed.
    """
    needed: list[tuple[str, str]] = [
        (DEMO_TAG_NAME, "free"),
        *((name, "capture_source") for name in CAPTURE_SOURCE_TAGS),
        *((name, "free") for name in FREE_TAG_POOL),
    ]
    rows = [{"name": name, "category": category} for name, category in needed]
    db.execute(pg_insert(Tag).values(rows).on_conflict_do_nothing(index_elements=["name"]))
    db.flush()
    return {t.name: t for t in db.query(Tag).filter(Tag.name.in_([n for n, _ in needed])).all()}


def _ensure_conflicts(db: Session) -> dict[str, Conflict]:
    """Create the conflicts the seeder uses if absent; return them keyed by name.

    Local-dev convenience mirroring `_ensure_tags`: in prod the referential
    is fed by the Wikidata seed + Wikipedia sync, but a fresh dev DB must be
    demoable without either. Race-safe via the `conflicts.name` UNIQUE.
    Rows land QID-less (`source='manual'`, `ongoing=true`); a later sync run
    adopts the ones the ongoing page also lists.
    """
    names = [*CONFLICT_BY_REGION.values(), CONFLICT_OTHER_NAME]
    rows = [
        {"id": uuid.uuid4(), "name": name, "ongoing": True, "source": "manual"} for name in names
    ]
    db.execute(pg_insert(Conflict).values(rows).on_conflict_do_nothing(index_elements=["name"]))
    db.flush()
    return {c.name: c for c in db.query(Conflict).filter(Conflict.name.in_(names)).all()}


# ── Public API ───────────────────────────────────────────────────────────


class NoTemplatesError(RuntimeError):
    """Raised when `demo-pool/` is empty or missing the expected layout."""


SEED_BATCH_SIZE = 1000


def seed_demo(db: Session, *, count: int) -> dict[str, int]:
    """Generate `count` demo geolocations.

    Idempotent on the demo authors (created once, reused). Commits in
    batches of `SEED_BATCH_SIZE` so memory + the SQLAlchemy identity map
    stay bounded on large seeds (e.g. 50 000) — earlier geos are flushed
    and detached as we move on. A mid-batch failure leaves earlier batches
    in the DB; the wipe button gives a clean redo.
    """
    if count < 1:
        raise ValueError("count must be at least 1")

    templates = _discover_templates()
    if not templates:
        raise NoTemplatesError(
            f"No demo templates found under '{DEMO_POOL_PREFIX}'. "
            "Populate the pool with at least one geo-XX/media/<file> "
            "before seeding."
        )

    authors = _ensure_demo_authors(db)
    tags_by_name = _ensure_tags(db)
    conflicts_by_name = _ensure_conflicts(db)
    db.commit()  # lock in demo authors + tags before the bulk loop
    author_ids = [a.id for a in authors]
    # Memoise tag IDs as plain UUIDs — pure-Python lookup, no per-geo
    # `SELECT FROM tags` round-trip (a big deal at 50 k+ scale).
    tag_ids_by_name: dict[str, uuid.UUID] = {n: t.id for n, t in tags_by_name.items()}
    conflict_ids_by_name: dict[str, uuid.UUID] = {n: c.id for n, c in conflicts_by_name.items()}
    template_ids = list(templates.keys())
    storage = get_storage()

    # One pass over every unique pool key (media + proof buckets): compute
    # sha256 and produce derivatives. Runs once per invocation regardless of
    # `count`, since the N demo rows all reference the same unique pool keys.
    pool_sha256_by_key = _prepare_pool_media(templates, storage)

    # Buffer M2M link + geolocator rows per batch, each flushed via one Core
    # INSERT, far cheaper than 1-4 ORM relationship writes per geo.
    pending_links: list[dict[str, uuid.UUID]] = []
    pending_conflict_links: list[dict[str, uuid.UUID]] = []
    pending_geolocators: list[dict[str, Any]] = []

    def _flush_batch() -> None:
        # Flush queued geos so the Core inserts' FK targets exist, but DON'T
        # commit yet, so geos and their tag links / geolocator credit live or
        # die together: an insert failure rolls back the geos too and the next
        # click retries cleanly. `commit() → insert links → commit()` left
        # geos committed and tagless on a mid-flush failure.
        db.flush()
        if pending_links:
            db.execute(insert(event_tags), pending_links)
            pending_links.clear()
        if pending_conflict_links:
            db.execute(insert(event_conflicts), pending_conflict_links)
            pending_conflict_links.clear()
        if pending_geolocators:
            # mypy types ``__table__`` as ``FromClause`` but at runtime it's a
            # ``Table`` and ``insert()`` accepts it.
            db.execute(insert(EventGeolocator.__table__), pending_geolocators)  # type: ignore[arg-type]
            pending_geolocators.clear()
        db.commit()
        db.expire_all()

    for i in range(count):
        region = _pick_region()
        lat, lon = _pick_point_for(region)
        author_id = random.choice(author_ids)
        template_id = random.choice(template_ids)
        template = templates[template_id]

        # Generate the geo's UUID upfront to stage the M2M links before
        # flushing — saves a per-geo flush just to read the auto-assigned id.
        geo_id = uuid.uuid4()

        event_date = _random_event_date()
        geo = Event(
            id=geo_id,
            owner_id=author_id,
            title=DEMO_TITLE,
            event_coords=from_shape(Point(lon, lat), srid=4326),
            source_url="https://vidit.app/demo-data",
            event_date=event_date,
            source_posted_at=_random_source_posted_at(event_date),
            # Born ``geolocated`` (the model default): stamp it, or the
            # ``ck_events_geolocated_stamp`` CHECK rejects the row.
            geolocated_at=datetime.now(UTC),
            is_demo=True,
        )

        # Exactly one source media (the DB caps source at one per event).
        source_key = random.choice(template["media"])
        geo.media.append(
            Media(
                role="source",
                storage_url=storage.public_url(source_key),
                media_type=_media_type_from_key(source_key),
                # ``get`` → ``None`` if the prep pass skipped this key
                # (storage miss between list + read): still a usable row,
                # just one a future audit flags as hash-less.
                sha256=pool_sha256_by_key.get(source_key),
            )
        )

        proof_keys: list[str] = []
        if template["proof"]:
            proof_keys = random.sample(
                template["proof"],
                k=random.randint(1, min(3, len(template["proof"]))),
            )
        # Run the demo proof through the same sanitiser as real submissions.
        # A no-op today (contents are seeder-controlled), but it makes the
        # seed write path identical to the public one so future drift in
        # `_build_proof` or the allowlist is caught, not silently bypassed.
        geo.proof = sanitize_tiptap_doc(_build_proof(proof_keys))
        # Same shape real submissions persist: one Media(role='proof') row per
        # inline image the proof body references.
        for key in proof_keys:
            geo.media.append(
                Media(
                    role="proof",
                    storage_url=storage.public_url(key),
                    media_type="image",
                    sha256=pool_sha256_by_key.get(key),
                )
            )

        # Durable credit: the demo owner vouched their own geolocation.
        pending_geolocators.append(
            {"event_id": geo_id, "user_id": author_id, "created_at": datetime.now(UTC)}
        )

        # Pick tag / conflict IDs from the memoised dicts and stage the link
        # rows for the bulk Core inserts: no DB hit, no ORM traversal.
        for tid in _pick_tag_ids_for(tag_ids_by_name):
            pending_links.append({"event_id": geo_id, "tag_id": tid})
        conflict_id = _conflict_id_for(region["name"], conflict_ids_by_name)
        if conflict_id is not None:
            pending_conflict_links.append({"event_id": geo_id, "conflict_id": conflict_id})

        db.add(geo)

        if (i + 1) % SEED_BATCH_SIZE == 0:
            _flush_batch()

    _flush_batch()

    # Wire a small social graph between demo authors so the timeline has
    # something to render after `make seed`. Each follows 1–3 peers —
    # populated without flattening into "everyone follows everyone."
    if len(authors) > 1:
        for follower in authors:
            others = [a for a in authors if a.id != follower.id]
            picks = random.sample(others, k=min(len(others), random.randint(1, 3)))
            for target in picks:
                social.follow_user(db, follower_id=follower.id, followed_user=target)
        db.commit()

    return {"created": count, "templates": len(template_ids), "authors": len(authors)}


def _conflict_id_for(
    region_name: str, conflict_ids_by_name: dict[str, uuid.UUID]
) -> uuid.UUID | None:
    """The conflict to attach to a demo geo: the region's mapped one if
    configured, else the `Other` escape value, satisfying the "one conflict
    per geo" invariant the submit form enforces."""
    name = CONFLICT_BY_REGION.get(region_name, CONFLICT_OTHER_NAME)
    return conflict_ids_by_name.get(name)


def _pick_tag_ids_for(tag_ids_by_name: dict[str, uuid.UUID]) -> list[uuid.UUID]:
    """Pick the tag IDs to attach to a demo geo:

    - Always the `demo` free tag — one filter chip scopes to / hides every
      synthetic row.
    - Exactly one random `capture_source` tag, exercising the required
      selector + its map filter.
    - 1–3 random free tags from the OSINT pool for multi-tag combinations.

    Pure Python — caller writes the IDs as M2M link rows via Core SQL.
    """
    ids: list[uuid.UUID] = []
    if DEMO_TAG_NAME in tag_ids_by_name:
        ids.append(tag_ids_by_name[DEMO_TAG_NAME])
    capture_source_name = random.choice(CAPTURE_SOURCE_TAGS)
    if capture_source_name in tag_ids_by_name:
        ids.append(tag_ids_by_name[capture_source_name])
    free_count = random.randint(1, 3)
    ids.extend(
        tag_ids_by_name[name]
        for name in random.sample(FREE_TAG_POOL, k=free_count)
        if name in tag_ids_by_name
    )
    return ids


# ── Requested-view (request) seeder ─────────────────────────────────────────

# Generic title for every demo request — same rationale as DEMO_TITLE;
# specific copy would imply factual claims about non-existent events.
# Phrased as an unplaced request ("I saw this, can't place it").
DEMO_REQUEST_TITLE = "Demo request: unplaced footage"
DEMO_REQUEST_SOURCE_URL = "https://vidit.app/demo-data"

# Probability a demo request gets ≥1 synthetic investigator, giving the "N
# working" badge something to render so the multi-analyst UI surfaces.
DEMO_REQUEST_CLAIM_PROBABILITY = 0.55

# Free-text close reason on withdrawn demo requests, so the transparency
# surface (the reason chip on a closed row) has something to render.
DEMO_CLOSE_REASON = "Withdrawn by the poster (synthetic demo row)."

# Status mix over the merged lifecycle. ``requested`` dominates so the default
# "open queue" view feels populated; ``geolocated`` is the fulfilled case (a
# located event with the original poster preserved on ``requested_by_id``), and
# ``closed`` is a withdrawn request. Weights sum to 1.0; sampled per-row.
DEMO_REQUEST_STATUS_WEIGHTS: tuple[tuple[EventStatus, float], ...] = (
    (STATUS_REQUESTED, 0.70),
    (STATUS_GEOLOCATED, 0.15),
    (STATUS_CLOSED, 0.15),
)


def _pick_demo_request_status() -> EventStatus:
    """Weighted draw from ``DEMO_REQUEST_STATUS_WEIGHTS``.

    Explicit loop rather than ``random.choices`` so the weights stay
    readable as percentages.
    """
    roll = random.random()
    cumulative = 0.0
    for status, weight in DEMO_REQUEST_STATUS_WEIGHTS:
        cumulative += weight
        if roll < cumulative:
            return status
    return STATUS_REQUESTED  # rounding fallback


def seed_demo_requests(db: Session, *, count: int) -> dict[str, int]:
    """Generate ``count`` demo requested-view events with a representative mix.

    Reuses the demo-author pool and the ``demo-pool/`` prefix. Each event gets a
    random subset of one template's ``media/`` files. Since the request +
    geolocation merge these are all rows on the one ``events`` table:

    * ``requested``: an open call, no location, ``requested_by_id`` = poster,
      may get 1-3 synthetic investigators (``DEMO_REQUEST_CLAIM_PROBABILITY``).
    * ``geolocated``: the fulfilled case, a located row whose ``owner_id`` is a
      *different* demo analyst (the fulfiller, also credited in
      ``event_geolocators``) while ``requested_by_id`` keeps the original
      poster, so "requested by @x, geolocated by @y" reads naturally.
    * ``closed``: a withdrawn request, no location, ``closed_at`` +
      ``before_closed_status='requested'`` + a demo ``close_reason``.

    Status mix from ``DEMO_REQUEST_STATUS_WEIGHTS`` so the status-filter chips +
    the requested_by banner UIs have data. Idempotent on demo authors / tags;
    commits at the end.
    """
    if count < 1:
        raise ValueError("count must be at least 1")

    templates = _discover_templates()
    if not templates:
        raise NoTemplatesError(
            f"No demo templates found under '{DEMO_POOL_PREFIX}'. "
            "Populate the pool with at least one geo-XX/media/<file> "
            "before seeding."
        )

    authors = _ensure_demo_authors(db)
    tags_by_name = _ensure_tags(db)
    conflicts_by_name = _ensure_conflicts(db)
    db.commit()
    author_ids = [a.id for a in authors]
    tag_ids_by_name: dict[str, uuid.UUID] = {n: t.id for n, t in tags_by_name.items()}
    conflict_ids_by_name: dict[str, uuid.UUID] = {n: c.id for n, c in conflicts_by_name.items()}
    template_ids = list(templates.keys())
    storage = get_storage()

    # Same prep pass as ``seed_demo``. Idempotent on already-derived keys,
    # so calling it from both seeders is harmless (second call is just
    # list_keys + per-key hash, no S3 writes).
    pool_sha256_by_key = _prepare_pool_media(templates, storage)

    pending_geo_tag_links: list[dict[str, uuid.UUID]] = []
    pending_conflict_links: list[dict[str, uuid.UUID]] = []
    pending_investigator_rows: list[dict[str, Any]] = []
    pending_geolocator_rows: list[dict[str, Any]] = []
    counts: dict[EventStatus, int] = {
        STATUS_REQUESTED: 0,
        STATUS_GEOLOCATED: 0,
        STATUS_CLOSED: 0,
    }
    claimed_count = 0

    for _ in range(count):
        author_id = random.choice(author_ids)
        template_id = random.choice(template_ids)
        template = templates[template_id]
        # Region drives tag selection; a fulfilled event also pulls its point
        # from this region's bbox.
        region = _pick_region()

        status = _pick_demo_request_status()
        counts[status] += 1

        geo_id = uuid.uuid4()
        event_date = _random_event_date()
        now = datetime.now(UTC)
        if status == STATUS_GEOLOCATED:
            # Fulfilled: a located row. A *different* demo analyst is the owner
            # (the fulfiller) while the poster stays on ``requested_by_id`` so
            # "requested by @x, geolocated by @y" reads naturally.
            other_authors = [aid for aid in author_ids if aid != author_id]
            fulfiller_id = random.choice(other_authors) if other_authors else author_id
            lat, lon = _pick_point_for(region)
            geo = Event(
                id=geo_id,
                owner_id=fulfiller_id,
                requested_by_id=author_id,
                title=DEMO_TITLE,
                event_coords=from_shape(Point(lon, lat), srid=4326),
                source_url=DEMO_REQUEST_SOURCE_URL,
                event_date=event_date,
                source_posted_at=_random_source_posted_at(event_date),
                status=STATUS_GEOLOCATED,
                requested_at=now,
                geolocated_at=now,
                is_demo=True,
            )
            # The fulfiller vouched the location: durable credit.
            pending_geolocator_rows.append(
                {"event_id": geo_id, "user_id": fulfiller_id, "created_at": now}
            )
        else:
            # Requested or closed — no location; the poster owns the row and is
            # also the requester. The withdrawn case stamps ``closed_at`` and
            # records which state it left (+ a visible reason).
            geo = Event(
                id=geo_id,
                owner_id=author_id,
                requested_by_id=author_id,
                title=DEMO_REQUEST_TITLE,
                source_url=DEMO_REQUEST_SOURCE_URL,
                event_date=event_date,
                source_posted_at=_random_source_posted_at(event_date),
                status=status,
                requested_at=now,
                closed_at=now if status == STATUS_CLOSED else None,
                before_closed_status=STATUS_REQUESTED if status == STATUS_CLOSED else None,
                close_reason=DEMO_CLOSE_REASON if status == STATUS_CLOSED else None,
                is_demo=True,
            )
        db.add(geo)

        # One source media per event (the DB caps source at one).
        source_key = random.choice(template["media"])
        db.add(
            Media(
                event_id=geo_id,
                role="source",
                storage_url=storage.public_url(source_key),
                media_type=_media_type_from_key(source_key),
                sha256=pool_sha256_by_key.get(source_key),
            )
        )

        for tid in _pick_tag_ids_for(tag_ids_by_name):
            pending_geo_tag_links.append({"event_id": geo_id, "tag_id": tid})
        conflict_id = _conflict_id_for(region["name"], conflict_ids_by_name)
        if conflict_id is not None:
            pending_conflict_links.append({"event_id": geo_id, "conflict_id": conflict_id})

        # Investigators only make sense on the open queue, not closed / geolocated
        # events don't accept new signals, and stale backfilled ones would
        # mislead the UI.
        if status == STATUS_REQUESTED and random.random() < DEMO_REQUEST_CLAIM_PROBABILITY:
            other_authors = [aid for aid in author_ids if aid != author_id]
            if other_authors:
                signal_count = random.randint(1, min(3, len(other_authors)))
                for investigator_id in random.sample(other_authors, k=signal_count):
                    pending_investigator_rows.append(
                        {
                            "event_id": geo_id,
                            "user_id": investigator_id,
                            "created_at": datetime.now(UTC),
                        }
                    )
                claimed_count += 1

    db.flush()
    if pending_geo_tag_links:
        db.execute(insert(event_tags), pending_geo_tag_links)
    if pending_conflict_links:
        db.execute(insert(event_conflicts), pending_conflict_links)
    # mypy types ``__table__`` as ``FromClause`` but at runtime it's a
    # ``Table`` and ``insert()`` accepts it, same as the
    # ``insert(event_tags)`` call above.
    if pending_investigator_rows:
        db.execute(insert(EventInvestigator.__table__), pending_investigator_rows)  # type: ignore[arg-type]
    if pending_geolocator_rows:
        db.execute(insert(EventGeolocator.__table__), pending_geolocator_rows)  # type: ignore[arg-type]
    db.commit()

    return {
        "created": count,
        "templates": len(template_ids),
        "authors": len(authors),
        "with_claims": claimed_count,
        "open": counts[STATUS_REQUESTED],
        "fulfilled": counts[STATUS_GEOLOCATED],
        "closed": counts[STATUS_CLOSED],
    }


def wipe_demo_requests(db: Session) -> dict[str, int]:
    """Delete every ``is_demo=True`` requested-view event.

    Scoped to the requested view (``requested`` / ``closed``) so the "Demo
    requests" panel stays independent of the "Demo data" panel: a fulfilled demo
    event is now ``geolocated`` (a located row) and is swept by ``wipe_demo``
    instead. Bulk Core DELETE for the same reasons as ``wipe_demo`` (speed +
    avoiding ORM cascade fighting the DB ``ON DELETE CASCADE``). The
    ``demo-pool/`` S3 objects stay (keys shared with the geo seeder).
    """
    deleted = (
        db.query(Event)
        .filter(
            Event.is_demo.is_(True),
            Event.status.in_((STATUS_REQUESTED, STATUS_CLOSED)),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted_requests": deleted or 0}


def wipe_demo(db: Session) -> dict[str, int]:
    """Delete every is_demo=True row.

    Bulk Core DELETE rather than ORM per-row, for two reasons:

    1. Speed — at 50k+ scale, per-row `db.delete(geo)` plus the ORM's
       autoflush of M2M-secondary cascades is orders of magnitude slower
       than a single `DELETE FROM events WHERE is_demo = true`.

    2. Correctness — the M2M `Event.tags` makes the ORM manage
       `event_tags` deletes itself, *fighting* the DB
       `ON DELETE CASCADE`: when the cascade drops the secondary rows
       first, the ORM's queued DELETE finds zero rows and raises
       `StaleDataError`. Bulk Core DELETE bypasses ORM cascade; the DB FK
       cascade handles `event_tags`, `media`, and the contributor tables.

    The `demo-pool/` S3 objects are NOT touched — shared re-seeding assets,
    not per-geo media.
    """
    geo_count = db.query(Event).filter(Event.is_demo.is_(True)).delete(synchronize_session=False)
    deleted_users = db.query(User).filter(User.is_demo.is_(True)).delete(synchronize_session=False)
    db.commit()
    return {"deleted_geos": geo_count or 0, "deleted_users": deleted_users or 0}
