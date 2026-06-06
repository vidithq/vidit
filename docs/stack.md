# Tech stack

## Selection principles

- **Open source first** — every component must be self-hostable or replaceable
- **Python backend** — matches the team's profile (data engineering)
- **Near-zero cost during the beta** — 10 users max, no reason to pay

---

## Stack

### Backend

| Component | Choice | Target version |
|-----------|--------|----------------|
| API framework | **FastAPI** | ≥ 0.115 |
| ASGI server | **Uvicorn** | ≥ 0.34 |
| ORM | **SQLAlchemy** | ≥ 2.0 |
| Geospatial extension | **GeoAlchemy2** | ≥ 0.15 |
| Migrations | **Alembic** | ≥ 1.14 |
| Authentication | **Cookie session + double-submit CSRF** (JWT payload via PyJWT); bcrypt for passwords | — |
| Validation | **Pydantic v2** | ≥ 2.0 |
| Rate limiting | **slowapi** | ≥ 0.1.9 |

### Database

| Component | Choice |
|-----------|--------|
| RDBMS | **PostgreSQL** (16 in prod on Railway, 18 locally — see [`docs/backups.md`](backups.md) for the version-mismatch rationale) |
| Geospatial extension | **PostGIS 3** |

PostgreSQL + PostGIS natively handles coordinates, bounding boxes, and geographic queries (radius, intersection…).

### Media storage

| Component | Choice |
|-----------|--------|
| Object storage | **AWS S3** (private bucket, eu-west region) |
| CDN | **AWS CloudFront** (with Origin Access Control) |
| Python SDK | `boto3` |

S3 + CloudFront from day one (not Supabase). Reasons: AWS familiarity in the team, evidence-preservation primitives (Object Lock, versioning, replication) align with the platform's mission, no future migration tax. The backend talks to storage through a small `Storage` protocol (`S3Storage` for prod, `LocalStorage` for dev/CI). Shipped in v0.0.2 — see [`CHANGELOG.md`](../CHANGELOG.md). *(The bucket + CloudFront distribution + OAC are live; bucket versioning, Object Lock (GOVERNANCE / 365d default), and the bucket CORS rule are in place.)*

### Frontend

| Component | Choice |
|-----------|--------|
| Framework | **Next.js 14** (App Router) |
| Language | **TypeScript** |
| Interactive map | **MapLibre GL JS** (via `react-map-gl/maplibre`) + **CARTO Dark Matter** vector tiles |
| Rich editor (proof) | **Tiptap** |
| Styles | **Tailwind CSS** |
| Icons | **lucide-react** |

MapLibre GL JS is fully open-source (BSD-3-Clause), uses vector tiles, and supports client-side clustering at scale. CARTO Dark Matter tiles are free for non-commercial use and visually align with the dark theme.

### Hosting

| Service | Platform | Estimated cost |
|---------|----------|----------------|
| Backend (FastAPI) | **Railway** | ~0–5 €/month |
| Frontend (Next.js) | **Vercel** | Free |
| Database (PostgreSQL + PostGIS) | **Railway** | Included in the plan |
| Media storage | **AWS S3 + CloudFront** | ~1–3 $/month at beta scale |

**Beta total (10 users): ~5 €/month.**

---

## Out of technical scope for the MVP

- Redis / external cache — not needed at this scale (an in-process TTL+LRU cache is used for the points endpoint, see `backend/app/cache.py`)
- Task queue (Celery, etc.) — no async processing in the MVP
- Multi-region S3 / cross-region replication — single-region is fine for closed beta
- Monitoring / observability — kept lean: UptimeRobot liveness checks on the API health endpoint + a Sentry SDK on both tiers (backend + frontend) for error capture, opt-in via a DSN env var (shipped v0.1.0 — see [`architecture.md`](architecture.md) → *Observability*). No full APM / tracing pipeline yet.
