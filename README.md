# Vidit

A platform for OSINT/GEOINT analysts to reference, archive, and visualize geolocations of armed-conflict events.

---

## Why

Analysts geolocating conflict events have no dedicated archive. Twitter/X loses posts; existing tools gate access and ship dated UIs.

Vidit is a map of analyst-validated geolocations with a structured submission flow (coords + source + media + rich proof + tags).

See [docs/roadmap.md](docs/roadmap.md).

---

## What's in the MVP

Five features:

1. **Auth** — invitation-only registration, cookie-based session login.
2. **Interactive map** — every geolocation as a clustered point, filterable by conflict and tag.
3. **Submission** — coordinates, source URL, media upload, rich Tiptap proof, tags, event date.
4. **Geolocation page** — full detail (map, media, proof, metadata).
5. **Analyst profile** — public-to-members page with the analyst's contributions.

Phases beyond the MVP: [docs/roadmap.md](docs/roadmap.md). What's currently open: [docs/next.md](docs/next.md). What's already shipped: [CHANGELOG.md](docs/CHANGELOG.md).

---

## Tech stack at a glance

| Layer | Choice |
|-------|--------|
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2 + GeoAlchemy2 + Alembic |
| Database | PostgreSQL + PostGIS 3 (16 in prod, 18 locally) |
| Auth | Cookie session + double-submit CSRF (JWT payload, PyJWT) + bcrypt + invite codes |
| Storage | AWS S3 + CloudFront (media) |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind |
| Map | MapLibre GL JS + CARTO Dark Matter tiles, client-side clustering |
| Editor | Tiptap (rich proof) |
| Hosting | Railway (API + DB) + Vercel (frontend) |
| Package mgmt | uv (backend) + npm (frontend) |

Details and rationale: [docs/engineering.md](docs/engineering.md).

---

## Repository layout

```
vidit/
├── backend/          FastAPI service (uv)
│   ├── app/          routers → services → models, Pydantic schemas
│   ├── alembic/      migrations
│   └── tests/
├── frontend/         Next.js 14 app (npm)
│   └── src/
│       ├── app/      App Router pages
│       ├── components/
│       └── lib/
├── docs/             roadmap, next, design, engineering, data-model, api, backups, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
├── docker/           custom PG image (PostGIS + AGE + pg_cron) + weekly backup cron
├── CLAUDE.md            project context for AI tools
├── LICENSE              AGPL-3.0
├── docker-compose.yml   PostgreSQL + PostGIS for local dev
├── Makefile             init / dev / seed / test entry points
└── .github/workflows/   backend + frontend CI + manual deploy
```

More detail: [docs/engineering.md](docs/engineering.md).

---

## Getting started (local dev)

**Fastest path — the `Makefile`:**

```bash
make init        # install + env + db-up + migrate (one-shot bootstrap)
make seed        # mock-admin + 50 demo geolocations
make dev         # FastAPI :8000 + Next.js :3000 in parallel
make test        # backend pytest
```

### Prerequisites

- Docker (for PostgreSQL + PostGIS)
- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 20+ and npm

### 1. Start the database

```bash
docker-compose up -d
```

This starts PostgreSQL 18 + PostGIS 3 on `localhost:5432` (db/user/password all `vision`). Prod runs PG 16 on Railway; local is PG 18. See [`docs/backups.md`](docs/backups.md) for restore implications.

### 2. Backend

```bash
cd backend
uv sync                                    # install deps
cp .env.example .env                       # then edit secrets (see below)
uv run alembic upgrade head                # run migrations
uv run uvicorn app.main:app --reload       # API on :8000
```

Notable settings in [`.env.example`](backend/.env.example):

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | `postgresql://vision:vision@localhost:5432/vision` |
| `JWT_SECRET` | any long random string for local; production uses `openssl rand -hex 32` |
| `STORAGE_BACKEND` | `local` (writes to `.local-storage/`) for dev; `s3` in production |
| `AWS_*`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN` | only required when `STORAGE_BACKEND=s3` |

API docs auto-served at <http://localhost:8000/docs>.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local           # NEXT_PUBLIC_API_URL preset for localhost
npm run dev                                # app on :3000
```

Only `NEXT_PUBLIC_API_URL` is required (full list in [`frontend/.env.local.example`](frontend/.env.local.example)); Sentry vars are optional. Prod values live in Vercel.

### 4. Bootstrap an account

**Easiest path:** `make seed` (or `make mock-admin`) creates `admin@vidit.app` / `admin` directly and skips registration.

**To exercise the real invite + registration flow:**

1. Set `ADMIN_EMAILS=<your-email>` in `backend/.env` so your account auto-promotes to admin on first login.
2. Get an invite code. Once an admin exists, the `/admin` panel mints them; for the very first one (no admin yet) run `make mock-admin` to get an admin whose panel can mint codes, or insert an `invite_codes` row via a Python REPL against the local DB.
3. Register at <http://localhost:3000/register> with the code. This stages a pending registration and sends a confirmation link.
4. `EMAIL_PROVIDER=console` (the local default) prints that link to **backend stdout**. Copy-paste it into the browser to create the account. (For real email in dev: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY=re_...` + a verified Resend domain.)

### 5. (Optional) seed the map

After registering as admin, populate `s3://<your-bucket>/demo-pool/geo-XX/{media,proof}/` (or, in local dev with `STORAGE_BACKEND=local`, `.local-storage/demo-pool/geo-XX/{media,proof}/`) with a few photos per template, then go to <http://localhost:3000/admin> → "Demo data" panel → enter a count → Generate. Demo geos carry a `demo` tag for filtering; wipe via the same panel.

### Troubleshooting

- **Database connection failed** — ensure `docker-compose up -d` is running and nothing else holds port 5432.
- **Frontend can't reach the API** — check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` is `http://localhost:8000/api/v1`.
- **"Module not found"** — re-run `uv sync` (backend) / `npm install` (frontend), or `make install` for both.

---

## Working on the project

### Backend

```bash
cd backend
uv run pytest                              # run tests
uv run ruff check .                        # lint
uv run ruff format .                       # format
uv run alembic revision --autogenerate -m "..."   # new migration
```

### Frontend

```bash
cd frontend
npm run lint
npm run build
```

### Conventions

See [CLAUDE.md](CLAUDE.md) → *Conventions*.

---

## Documentation

### Product

- [Roadmap](docs/roadmap.md) — vision, 4 phases, openness commitment
- [What's next](docs/next.md) — milestones (scheduled) + unscheduled candidates
- [Design system](docs/design.md)

### Technical

- [Engineering](docs/engineering.md) — stack, repo layout, deployment, particularities
- [Data model](docs/data-model.md)
- [REST API](docs/api.md)
- [Backups & restore](docs/backups.md) — weekly cron, restore drill, manual snapshot + rollback

### Releases

- [docs/CHANGELOG.md](docs/CHANGELOG.md) — what shipped per release

---

## Deployment

Manual via [`deploy` workflow](.github/workflows/deploy.yml) (`workflow_dispatch`). Auto-deploy on `main` is **off**. Full runbook (services, env vars, releasing, rollback, observability): [`docs/engineering.md`](docs/engineering.md) → *Deployment*. Backups + restore drill: [`docs/backups.md`](docs/backups.md).

---

## License

Vidit is licensed under the **GNU Affero General Public License v3.0** — see [`LICENSE`](LICENSE) for the full text. AGPL-3.0 means anyone can use, study, modify, and self-host the platform; modifications that are deployed as a network service must publish their source under the same license. The rationale (open codebase, monetization via API rate limits on the maintainer's hosted instance) lives in [`docs/roadmap.md`](docs/roadmap.md) → *Openness & transparency*.

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and [`docs/SECURITY.md`](docs/SECURITY.md). Code of Conduct: [Contributor Covenant 2.1](docs/CODE_OF_CONDUCT.md).
