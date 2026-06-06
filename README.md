# Vidit

A platform for OSINT/GEOINT analysts to reference, archive, and visualize geolocations of armed-conflict events worldwide.

> **Status:** closed beta in development. Access by invitation only.

---

## Why

Analysts who geolocate conflict events have no dedicated tool to archive and share their work. Twitter/X loses posts in the feed, the few existing platforms gate access and ship dated UIs, and there is no shared, professional, structured place for the community to land on.

Vidit is that place: a clean, fast, opinionated map of analyst-validated geolocations, with a structured submission flow (coords + source + media + rich proof + tags) that mirrors how analysts actually work.

See [docs/vision.md](docs/vision.md) for the long form.

---

## What's in the MVP

Five features, nothing more:

1. **Auth** — invitation-only registration, cookie-based session login.
2. **Interactive map** — every geolocation as a clustered point, filterable by conflict and tag.
3. **Submission** — coordinates, source URL, media upload, rich Tiptap proof, tags, event date.
4. **Geolocation page** — full detail (map, media, proof, metadata).
5. **Analyst profile** — public-to-members page with the analyst's contributions.

Phases beyond the MVP: [docs/roadmap.md](docs/roadmap.md). What's currently open: [docs/next.md](docs/next.md). What's already shipped: [CHANGELOG.md](CHANGELOG.md).

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

Details and rationale: [docs/stack.md](docs/stack.md).

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
├── docs/             vision, roadmap, next, design, stack, architecture, data-model, api, backups
├── docker/           custom PG image (PostGIS + AGE + pg_cron) + weekly backup cron
├── CLAUDE.md            project context for AI tools
├── CHANGELOG.md         what shipped per release
├── docker-compose.yml   PostgreSQL + PostGIS for local dev
├── Makefile             init / dev / seed / test entry points
└── .github/workflows/   backend + frontend CI + manual deploy
```

More detail: [docs/architecture.md](docs/architecture.md).

---

## Getting started (local dev)

**Fastest path — the `Makefile`:** `make init` (install + env + db-up + migrate) → `make seed` (mock-admin + 50 demo geolocations) → `make dev` (FastAPI on `:8000` + Next.js on `:3000` in parallel). `make test` runs the backend suite. The steps below are the manual equivalent and the per-setting detail.

### Prerequisites

- Docker (for PostgreSQL + PostGIS)
- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 20+ and npm

### 1. Start the database

```bash
docker-compose up -d
```

This starts PostgreSQL 18 + PostGIS 3 on `localhost:5432` (db/user/password all `vision` — legacy local default kept for `.env` continuity through the Vision → Vidit rename). Prod runs PG 16 on Railway; the local PG 18 image is intentional so the dev environment exercises a newer planner — see [`docs/backups.md`](docs/backups.md) for the restore-drill implications.

### 2. Backend

```bash
cd backend
uv sync                                    # install deps
cp .env.example .env                       # then edit secrets (see below)
uv run alembic upgrade head                # run migrations
uv run uvicorn app.main:app --reload       # API on :8000
```

The local defaults in [`.env.example`](backend/.env.example) are enough to boot. Notable settings:

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

Settings are documented inline in [`frontend/.env.local.example`](frontend/.env.local.example) — the only required var today is `NEXT_PUBLIC_API_URL`; optional Sentry vars are listed but commented out. Production values live in Vercel.

### 4. Bootstrap an account

**Easiest path:** `make seed` (or `make mock-admin`) creates `admin@vidit.app` / `admin` directly and skips registration — use it if you just want an admin to log in with.

**To exercise the real invite + registration flow:**

1. Set `ADMIN_EMAILS=<your-email>` in `backend/.env` so your account auto-promotes to admin on first login.
2. Get an invite code. Once an admin exists, the `/admin` panel mints them; for the very first one (no admin yet) run `make mock-admin` to get an admin whose panel can mint codes, or insert an `invite_codes` row via a Python REPL against the local DB.
3. Register at <http://localhost:3000/register> with the code. This does **not** create the account immediately — it stages a pending registration and sends a confirmation link.
4. `EMAIL_PROVIDER=console` (the local default) prints that link to **backend stdout** instead of emailing it. Copy-paste it into the browser to create the account and land logged in. (For real email in dev: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY=re_...` + a verified Resend domain.)

### 5. (Optional) seed the map

After registering as admin, populate `s3://<your-bucket>/demo-pool/geo-XX/{media,proof}/` (or, in local dev with `STORAGE_BACKEND=local`, `.local-storage/demo-pool/geo-XX/{media,proof}/`) with a few photos per template, then go to <http://localhost:3000/admin> → "Demo data" panel → enter a count → Generate. Demo geos carry an always-on `demo` tag so you can scope (or hide) them with a single filter chip on the map; they're wiped via the same panel.

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

- **Code language:** English — variables, functions, comments, commit messages.
- **Documentation language:** English (this repo, `docs/`, this README).
- **Backend layering:** routers → services → models. No business logic in routers.
- **Pydantic schema naming:** `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`.
- **API contracts:** see [docs/api.md](docs/api.md). Endpoints follow that spec.

---

## Documentation

### Product

- [Mission & persona](docs/vision.md)
- [Roadmap](docs/roadmap.md) — 4 phases, forward-looking
- [What's next](docs/next.md) — milestones (scheduled) + unscheduled candidates
- [Design system](docs/design.md)

### Technical

- [Stack](docs/stack.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [REST API](docs/api.md)
- [Backups & restore](docs/backups.md) — weekly cron, restore drill, manual snapshot + rollback

### Releases

- [CHANGELOG.md](CHANGELOG.md) — what shipped per release

---

## Deployment

| Service | Platform | Trigger |
|---------|----------|---------|
| Backend (FastAPI + Alembic) | Railway | Manual via [`deploy` workflow](.github/workflows/deploy.yml) (`workflow_dispatch`) — Dockerfile build, pre-deploy `alembic upgrade head` |
| Frontend (Next.js) | Vercel | Manual via [`deploy` workflow](.github/workflows/deploy.yml) (`workflow_dispatch`) — `vercel pull` + `vercel build` + `vercel deploy --prebuilt --prod` |
| Database (PostgreSQL + PostGIS) | Railway | Managed |
| Media storage | AWS S3 + CloudFront | `Storage` abstraction with `S3Storage` / `LocalStorage` backends |

Auto-deploy on push to `main` is intentionally **off** during the closed beta. Every prod release goes through the [`deploy` workflow](.github/workflows/deploy.yml) so the deploy ref is recorded on a GitHub Actions run page, side-by-side with who clicked the button.

Production env vars (`DATABASE_URL`, `JWT_SECRET`, `STORAGE_BACKEND=s3`, `AWS_*`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`) live in the platform secret managers, never in the repo. See [`backend/.env.example`](backend/.env.example) for the full list.

The `deploy` workflow itself needs four secrets in repo settings → Secrets and variables → Actions:

- `RAILWAY_TOKEN` — project token from Railway → project settings → tokens
- `VERCEL_TOKEN` — personal token from https://vercel.com/account/tokens
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — copied from `frontend/.vercel/project.json` after a one-off `vercel link` against the production project

### Releasing

```
1. Merge PR into main, CI green
2. git tag -a v0.1.x -m "..." && git push origin v0.1.x
3. GitHub → Actions → deploy → Run workflow:
     - ref:    v0.1.x
     - target: both
4. Watch the run: backend job builds + ships to Railway (alembic migrations run as the pre-deploy step), frontend job runs vercel pull / build / deploy
5. Hit the deployed instance end-to-end (smoke-test the flows that matter for the release); log anything weird in a scratch findings file at the repo root
6. (Optional, post-deploy) GitHub → Releases → Draft a new release on the tag for the changelog
```

Rollback: re-run the `deploy` workflow with `ref` set to a previous tag (or any past commit SHA). Both sides redeploy independently — pick `target: backend` or `target: frontend` to roll back only one side. Backend's "Redeploy previous" button in the Railway dashboard works as a same-day fallback if Actions is wedged.

### Database backup & rollback

Migrations run as a Railway pre-deploy step (`uv run alembic upgrade head`). A failed migration leaves the schema half-applied, and a code rollback alone won't fix it — **always snapshot the DB before a deploy that includes a migration.**

The full runbook — manual pre-deploy snapshot, the three-tier recovery order (code-only rollback / schema downgrade / full restore), plus the weekly automated `pg_dump` → S3 cron, how to tell it failed, and the restore drill — lives in [`docs/backups.md`](docs/backups.md).

Open operational work — security hardening, seed data, legal pre-flight — lives in [`docs/next.md`](docs/next.md). What's already shipped is in [`CHANGELOG.md`](CHANGELOG.md).

---

## License

Vidit is licensed under the **GNU Affero General Public License v3.0** — see [`LICENSE`](LICENSE) for the full text. AGPL-3.0 means anyone can use, study, modify, and self-host the platform; modifications that are deployed as a network service must publish their source under the same license. The rationale (open codebase, monetization via API rate limits on the maintainer's hosted instance) lives in [`docs/roadmap.md`](docs/roadmap.md) → *Openness & transparency*.

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md). The project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
