# Vidit

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/live-vidit.app-orange)](https://vidit.app)

A web platform for OSINT/GEOINT analysts to archive, reference, and visualize geolocations of armed-conflict events. Interactive map, structured submission flow (coords + source + media + Tiptap proof + tags), community bounties, and analyst profiles.

Live at **[vidit.app](https://vidit.app)** (closed beta).

---

## Why open source

**100% open source under [AGPL-3.0](LICENSE) — nothing proprietary.** Anyone can self-host the platform; modifications deployed as a network service must publish their source under the same license. Monetization on the maintainer's hosted instance (`vidit.app`) is API rate limits + a small set of paid-only endpoints (alert webhooks, larger exports) — the analyst-facing platform is, and will stay, free. Strategy lives in [`planning/roadmap.md`](planning/roadmap.md) → *Openness & transparency*.

---

## Demo

<!--
Embed the promo MP4 inline once it's uploaded. To upload: open a draft
GitHub issue or release, drag the file from `video/out/promo-final.mp4`
into the description, copy the `https://github.com/user-attachments/...`
URL GitHub generates, and replace the placeholder line below. GitHub
auto-renders the player when the URL is on a line by itself.
-->

Short walkthrough: [vidit.app](https://vidit.app) renders the same `.mp4` in the hero. A GitHub user-attachment embed lands here once the next re-render is uploaded.

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
│   ├── scripts/      one-off ops scripts (mock admin, demo seeders)
│   └── tests/
├── frontend/         Next.js 14 app (npm)
│   └── src/
│       ├── app/         App Router pages
│       ├── components/
│       ├── contexts/    React context providers (auth, map state)
│       ├── hooks/
│       ├── lib/
│       ├── types/
│       └── middleware.ts   default-deny auth + host canonicalisation
├── video/            promo-as-code pipeline (Playwright capture + Remotion render, `make promo`)
├── docs/             api, backups, data-model, design, engineering (technical reference)
├── planning/         roadmap + next (project planning, not user docs)
├── docker/           custom PG image (PostGIS + AGE + pg_cron) + weekly backup cron
├── AGENTS.md            project context for AI tools (CLAUDE.md is a one-line `@AGENTS.md` pointer for Claude Code)
├── CHANGELOG.md         release history
├── CODE_OF_CONDUCT.md   Contributor Covenant 2.1
├── CONTRIBUTING.md      PR flow + commits + doc-sync rule
├── LICENSE              AGPL-3.0
├── SECURITY.md          vulnerability reporting
├── docker-compose.yml   PostgreSQL + PostGIS for local dev
├── Makefile             init / dev / seed / test entry points
└── .github/workflows/   backend + frontend CI + manual deploy
```

More detail: [docs/engineering.md](docs/engineering.md).

---

## Documentation

- [Roadmap](planning/roadmap.md)
- [What's next](planning/next.md)
- [Engineering](docs/engineering.md)
- [Data model](docs/data-model.md)
- [REST API](docs/api.md)
- [Design system](docs/design.md)
- [Backups & restore](docs/backups.md)
- [CHANGELOG](CHANGELOG.md)

---

## Getting started (local dev)

```bash
make init        # install + env + db-up + migrate (one-shot bootstrap)
make seed        # mock-admin + 50 demo geolocations + admin follows every demo analyst
make dev         # FastAPI :8000 + Next.js :3000 in parallel
make test        # backend pytest
```

`make help` lists every target individually.

### Prerequisites

- Docker (for PostgreSQL + PostGIS — prod runs PG 16 on Railway; local is PG 18, see [`docs/backups.md`](docs/backups.md) for restore implications)
- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 20+ and npm

### Secrets

`make init` copies `.env.example` → `.env` (backend) and `.env.local.example` → `.env.local` (frontend). Defaults are wired for `localhost`; every var is documented inline in [`backend/.env.example`](backend/.env.example) and [`frontend/.env.local.example`](frontend/.env.local.example). API docs auto-served at <http://localhost:8000/docs>.

### Bootstrap an account

`make seed` (or `make mock-admin`) creates `admin@vidit.app` / `admin` directly. To exercise the real invite + registration flow:

1. Set `ADMIN_EMAILS=<your-email>` in `backend/.env` so your account auto-promotes to admin on first login.
2. Get an invite code: once an admin exists, the `/admin` panel mints them; for the very first one run `make mock-admin` to get one.
3. Register at <http://localhost:3000/register> with the code.
4. `EMAIL_PROVIDER=console` (the local default) prints the confirmation link to **backend stdout**.

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

See [AGENTS.md](AGENTS.md) → *Conventions*.

---

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE). See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

---

## Acknowledgements

The demo content shipped on the landing video and in the seed bounties uses real geolocation work from [`@geo27752`](https://x.com/geo27752), reproduced with their consent. Thanks for letting Vidit show the platform the way analysts actually use it.
