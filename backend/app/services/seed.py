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
from datetime import UTC, date, datetime, timedelta
from typing import Any

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.bounty import (
    STATUS_CLOSED,
    STATUS_FULFILLED,
    STATUS_OPEN,
    Bounty,
    BountyClaim,
    bounty_tags,
)
from app.models.geolocation import Geolocation
from app.models.media import Media
from app.models.tag import Tag, geolocation_tags
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
        "trust_reason": "Demo account — established OSINT presence (synthetic).",
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
        "trust_reason": "Demo account — long-standing contributor (synthetic).",
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

# Conflict tags by region. Set only where a curated `conflict` tag exists;
# other regions get none (background-only points). Names must match the
# `tags` table — the seeder creates them if absent.
CONFLICT_TAG_BY_REGION: dict[str, str] = {
    "Ukraine": "Ukraine",
    "Middle East": "Israel Gaza",
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

# Conflict escape value (also seeded by `s5n7p9r1t3v5`). Demo geos in
# regions with no curated conflict tag get this, so every row satisfies the
# "one conflict per geo" intent and the "Other" chip is exercised.
CONFLICT_OTHER_TAG = "Other"


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
    """Hash every pool media key + produce derivatives where missing.

    For each unique media key referenced by `templates`:

    1. Download the original bytes. **Runs once per seed invocation, not
       once per pool lifetime** — the sha256 isn't cached on the bucket, so
       every call re-downloads the pool to recompute it (~100s of S3 GETs,
       seconds at current scale). If the pool grows, cache the sha256 in a
       sibling object.
    2. Compute the sha256 hex so the row constructor sets ``Media.sha256``,
       matching the evidence-integrity contract real uploads honour.
    3. For images, generate JPEG hero + thumbnail derivatives at the sibling
       keys — skipped if already present. Skipping matters: a re-seed would
       otherwise rewrite identical bytes, which the bucket's Object Lock +
       versioning turns into unbounded version churn.

    Videos: hashed for the row, no derivatives (no first-frame extraction).

    Returns ``{pool_key: sha256_hex}``. Proof-image keys are excluded —
    they create no Media rows and render through the editor via the
    original URL.

    Failure handling (both partial-success, neither aborts the seed): a
    per-key ``get_bytes`` miss is logged + skipped (the row lands with
    ``sha256=NULL`` and a ``storage_url`` pointing at the missing original,
    404ing on the detail page); a per-derivative ``put_bytes_sync`` failure
    is logged + skipped (sha256 still lands — computed pre-upload — but the
    frontend 404s on the hero/thumb until the next seed).
    """
    unique_media_keys: set[str] = set()
    for template in templates.values():
        unique_media_keys.update(template["media"])

    # One list_keys call up front to pick up derivatives from a prior seed
    # run. (``_discover_templates`` already paid this once; the re-list is
    # cheap — size is bounded by the pool, ~100s of keys.)
    existing_keys = set(storage.list_keys(DEMO_POOL_PREFIX))

    sha256_by_key: dict[str, str] = {}
    derivatives_written = 0
    for key in sorted(unique_media_keys):
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
        *((name, "conflict") for name in CONFLICT_TAG_BY_REGION.values()),
        (CONFLICT_OTHER_TAG, "conflict"),
        *((name, "capture_source") for name in CAPTURE_SOURCE_TAGS),
        *((name, "free") for name in FREE_TAG_POOL),
    ]
    rows = [{"name": name, "category": category} for name, category in needed]
    db.execute(pg_insert(Tag).values(rows).on_conflict_do_nothing(index_elements=["name"]))
    db.flush()
    return {t.name: t for t in db.query(Tag).filter(Tag.name.in_([n for n, _ in needed])).all()}


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
    db.commit()  # lock in demo authors + tags before the bulk loop
    author_ids = [a.id for a in authors]
    # Memoise tag IDs as plain UUIDs — pure-Python lookup, no per-geo
    # `SELECT FROM tags` round-trip (a big deal at 50 k+ scale).
    tag_ids_by_name: dict[str, uuid.UUID] = {n: t.id for n, t in tags_by_name.items()}
    template_ids = list(templates.keys())
    storage = get_storage()

    # One pass over every unique pool media key: compute sha256 and produce
    # derivatives. Runs once per invocation regardless of `count`, since the
    # N demo rows all reference the same unique pool keys.
    pool_sha256_by_key = _prepare_pool_media(templates, storage)

    # Buffer M2M link rows per batch, flushed via one Core
    # `INSERT INTO geolocation_tags` — far cheaper than 1-4 ORM
    # relationship writes per geo.
    pending_links: list[dict[str, uuid.UUID]] = []

    def _flush_batch() -> None:
        # Flush queued geos so the M2M insert's FK targets exist, but DON'T
        # commit yet, so geos and their tag links live or die together: an
        # M2M insert failure rolls back the geos too and the next click
        # retries cleanly. `commit() → insert links → commit()` left geos
        # committed and tagless on a mid-flush failure.
        db.flush()
        if pending_links:
            db.execute(insert(geolocation_tags), pending_links)
            pending_links.clear()
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

        geo = Geolocation(
            id=geo_id,
            author_id=author_id,
            title=DEMO_TITLE,
            location=from_shape(Point(lon, lat), srid=4326),
            source_url="https://vidit.app/demo-data",
            event_date=_random_event_date(),
            is_demo=True,
        )

        media_subset = random.sample(
            template["media"],
            k=random.randint(1, min(3, len(template["media"]))),
        )
        for key in media_subset:
            geo.media.append(
                Media(
                    storage_url=storage.public_url(key),
                    media_type=_media_type_from_key(key),
                    # ``get`` → ``None`` if the prep pass skipped this key
                    # (storage miss between list + read): still a usable row,
                    # just one a future audit flags as hash-less.
                    sha256=pool_sha256_by_key.get(key),
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

        # Pick tag IDs from the memoised dict and stage the link rows for
        # the bulk Core insert — no DB hit, no ORM traversal.
        for tid in _pick_tag_ids_for(region["name"], tag_ids_by_name):
            pending_links.append({"geolocation_id": geo_id, "tag_id": tid})

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


def _pick_tag_ids_for(region_name: str, tag_ids_by_name: dict[str, uuid.UUID]) -> list[uuid.UUID]:
    """Pick the tag IDs to attach to a demo geo:

    - Always the `demo` free tag — one filter chip scopes to / hides every
      synthetic row.
    - Exactly one `conflict` tag: the region's curated one if configured,
      else "Other" — satisfies the "one conflict per geo" invariant the
      submit form enforces.
    - Exactly one random `capture_source` tag, exercising the required
      selector + its map filter.
    - 1–3 random free tags from the OSINT pool for multi-tag combinations.

    Pure Python — caller writes the IDs as M2M link rows via Core SQL.
    """
    ids: list[uuid.UUID] = []
    if DEMO_TAG_NAME in tag_ids_by_name:
        ids.append(tag_ids_by_name[DEMO_TAG_NAME])
    conflict_name = CONFLICT_TAG_BY_REGION.get(region_name, CONFLICT_OTHER_TAG)
    if conflict_name in tag_ids_by_name:
        ids.append(tag_ids_by_name[conflict_name])
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


# ── Bounty seeder ────────────────────────────────────────────────────────

# Generic title for every demo bounty — same rationale as DEMO_TITLE;
# specific copy would imply factual claims about non-existent events.
# Phrased as an unplaced bounty ("I saw this, can't place it").
DEMO_BOUNTY_TITLE = "Demo bounty — unplaced footage"
DEMO_BOUNTY_SOURCE_URL = "https://vidit.app/demo-data"

# Probability a demo bounty gets ≥1 synthetic claim — gives the "N
# working" badge something to render so the multi-claimer UI surfaces.
DEMO_BOUNTY_CLAIM_PROBABILITY = 0.55

# Status mix. Open dominates so the default "open queue" view feels
# populated; the others are sprinkled in for the status-filter chips and
# the trace banner (bounty ``Fulfilled by`` + geo "originally posted as a
# bounty"). Weights sum to 1.0; sampled per-bounty.
DEMO_BOUNTY_STATUS_WEIGHTS = (
    (STATUS_OPEN, 0.70),
    (STATUS_FULFILLED, 0.15),
    (STATUS_CLOSED, 0.15),
)


def _pick_demo_bounty_status() -> str:
    """Weighted draw from ``DEMO_BOUNTY_STATUS_WEIGHTS``.

    Explicit loop rather than ``random.choices`` so the weights stay
    readable as percentages.
    """
    roll = random.random()
    cumulative = 0.0
    for status, weight in DEMO_BOUNTY_STATUS_WEIGHTS:
        cumulative += weight
        if roll < cumulative:
            return status
    return STATUS_OPEN  # rounding fallback


def seed_demo_bounties(db: Session, *, count: int) -> dict[str, int]:
    """Generate ``count`` demo bounties with a representative status mix.

    Reuses the demo-author pool and the ``demo-pool/`` prefix — bounties
    need media but not coordinates, so the same template imagery is reused.
    Each gets a random subset of one template's ``media/`` files; for
    *fulfilled* bounties the media lives on the paired geolocation
    (mirroring real fulfilment's in-place UPDATE), for *open* / *closed* it
    stays on the bounty.

    Status mix from ``DEMO_BOUNTY_STATUS_WEIGHTS`` so the status-filter
    chips + trace-banner UIs have data. Fulfilled bounties get a paired
    demo geo (``is_demo=True``, ``originated_from_bounty_id`` set) to
    exercise the "Fulfilled by" row + the geo's "originally posted as a
    bounty" banner. Open bounties may get 1–3 synthetic claims (see
    ``DEMO_BOUNTY_CLAIM_PROBABILITY``).

    Idempotent on demo authors / tags; commits at the end.
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
    db.commit()
    author_ids = [a.id for a in authors]
    tag_ids_by_name: dict[str, uuid.UUID] = {n: t.id for n, t in tags_by_name.items()}
    template_ids = list(templates.keys())
    storage = get_storage()

    # Same prep pass as ``seed_demo``. Idempotent on already-derived keys,
    # so calling it from both seeders is harmless (second call is just
    # list_keys + per-key hash, no S3 writes).
    pool_sha256_by_key = _prepare_pool_media(templates, storage)

    pending_tag_links: list[dict[str, uuid.UUID]] = []
    pending_geo_tag_links: list[dict[str, uuid.UUID]] = []
    pending_claim_rows: list[dict[str, Any]] = []
    counts = {STATUS_OPEN: 0, STATUS_FULFILLED: 0, STATUS_CLOSED: 0}
    claimed_count = 0

    for _ in range(count):
        author_id = random.choice(author_ids)
        template_id = random.choice(template_ids)
        template = templates[template_id]
        # Region drives tag selection; a fulfilled bounty's paired geo also
        # pulls its point from this region's bbox.
        region = _pick_region()

        status = _pick_demo_bounty_status()
        counts[status] += 1
        # closed_at stamped for any terminal-state bounty so the detail page
        # can show "Fulfilled/Closed YYYY-MM-DD".
        closed_at = datetime.now(UTC) if status != STATUS_OPEN else None

        bounty_id = uuid.uuid4()
        bounty = Bounty(
            id=bounty_id,
            author_id=author_id,
            title=DEMO_BOUNTY_TITLE,
            source_url=DEMO_BOUNTY_SOURCE_URL,
            status=status,
            closed_at=closed_at,
            is_demo=True,
        )
        db.add(bounty)

        media_subset = random.sample(
            template["media"],
            k=random.randint(1, min(3, len(template["media"]))),
        )

        if status == STATUS_FULFILLED:
            # Media transferred to a paired geo. ``is_demo=True`` so the wipe
            # path sweeps it too. A *different* demo analyst authors the geo
            # so "fulfilled by @other" reads naturally.
            other_authors = [aid for aid in author_ids if aid != author_id]
            fulfiller_id = random.choice(other_authors) if other_authors else author_id
            lat, lon = _pick_point_for(region)
            geo_id = uuid.uuid4()
            geo = Geolocation(
                id=geo_id,
                author_id=fulfiller_id,
                title=DEMO_TITLE,
                location=from_shape(Point(lon, lat), srid=4326),
                source_url="https://vidit.app/demo-data",
                event_date=_random_event_date(),
                is_demo=True,
                originated_from_bounty_id=bounty_id,
            )
            db.add(geo)
            for key in media_subset:
                db.add(
                    Media(
                        geolocation_id=geo_id,
                        storage_url=storage.public_url(key),
                        media_type=_media_type_from_key(key),
                        sha256=pool_sha256_by_key.get(key),
                    )
                )
            # Tag the paired geo so it filters alongside the rest of the set.
            for tid in _pick_tag_ids_for(region["name"], tag_ids_by_name):
                pending_geo_tag_links.append({"geolocation_id": geo_id, "tag_id": tid})
        else:
            # Open or closed — media stays on the bounty.
            for key in media_subset:
                db.add(
                    Media(
                        bounty_id=bounty_id,
                        storage_url=storage.public_url(key),
                        media_type=_media_type_from_key(key),
                        sha256=pool_sha256_by_key.get(key),
                    )
                )

        for tid in _pick_tag_ids_for(region["name"], tag_ids_by_name):
            pending_tag_links.append({"bounty_id": bounty_id, "tag_id": tid})

        # Claims only make sense on the open queue — fulfilled / closed
        # bounties don't accept new claims, and stale backfilled claims
        # would mislead the UI.
        if status == STATUS_OPEN and random.random() < DEMO_BOUNTY_CLAIM_PROBABILITY:
            other_authors = [aid for aid in author_ids if aid != author_id]
            if other_authors:
                claim_count = random.randint(1, min(3, len(other_authors)))
                for claimer_id in random.sample(other_authors, k=claim_count):
                    pending_claim_rows.append(
                        {
                            "bounty_id": bounty_id,
                            "user_id": claimer_id,
                            "created_at": datetime.now(UTC),
                        }
                    )
                claimed_count += 1

    db.flush()
    if pending_tag_links:
        db.execute(insert(bounty_tags), pending_tag_links)
    if pending_geo_tag_links:
        db.execute(insert(geolocation_tags), pending_geo_tag_links)
    if pending_claim_rows:
        # mypy types ``__table__`` as ``FromClause`` but at runtime it's a
        # ``Table`` and ``insert()`` accepts it — same as the
        # ``insert(geolocation_tags)`` calls above.
        db.execute(insert(BountyClaim.__table__), pending_claim_rows)  # type: ignore[arg-type]
    db.commit()

    return {
        "created": count,
        "templates": len(template_ids),
        "authors": len(authors),
        "with_claims": claimed_count,
        "open": counts[STATUS_OPEN],
        "fulfilled": counts[STATUS_FULFILLED],
        "closed": counts[STATUS_CLOSED],
    }


def wipe_demo_bounties(db: Session) -> dict[str, int]:
    """Delete every ``is_demo=True`` bounty.

    Bulk Core DELETE for the same reasons as ``wipe_demo`` (speed +
    avoiding ORM cascade fighting the DB ``ON DELETE CASCADE``). The
    ``demo-pool/`` S3 objects stay (keys shared with the geo seeder). Demo
    users + geos are untouched — those are behind ``wipe_demo``.
    """
    deleted = db.query(Bounty).filter(Bounty.is_demo.is_(True)).delete(synchronize_session=False)
    db.commit()
    return {"deleted_bounties": deleted or 0}


def wipe_demo(db: Session) -> dict[str, int]:
    """Delete every is_demo=True row.

    Bulk Core DELETE rather than ORM per-row, for two reasons:

    1. Speed — at 50k+ scale, per-row `db.delete(geo)` plus the ORM's
       autoflush of M2M-secondary cascades is orders of magnitude slower
       than a single `DELETE FROM geolocations WHERE is_demo = true`.

    2. Correctness — the M2M `Geolocation.tags` makes the ORM manage
       `geolocation_tags` deletes itself, *fighting* the DB
       `ON DELETE CASCADE`: when the cascade drops the secondary rows
       first, the ORM's queued DELETE finds zero rows and raises
       `StaleDataError`. Bulk Core DELETE bypasses ORM cascade; the DB FK
       cascade handles `geolocation_tags`, `media`, `proof_images`.

    The `demo-pool/` S3 objects are NOT touched — shared re-seeding assets,
    not per-geo media.
    """
    geo_count = (
        db.query(Geolocation)
        .filter(Geolocation.is_demo.is_(True))
        .delete(synchronize_session=False)
    )
    deleted_users = db.query(User).filter(User.is_demo.is_(True)).delete(synchronize_session=False)
    db.commit()
    return {"deleted_geos": geo_count or 0, "deleted_users": deleted_users or 0}
