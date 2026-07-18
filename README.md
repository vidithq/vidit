# Vidit

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/live-vidit.app-orange)](https://vidit.app)

A web platform for OSINT/GEOINT analysts to archive, reference, and visualize geolocations of armed-conflict events. Interactive map, structured submission flow (coords + source + media + Tiptap proof + tags), community requests, and analyst profiles.

Live at **[vidit.app](https://vidit.app)** (closed beta).

---

## Why open source

**100% open source under [AGPL-3.0](LICENSE), nothing proprietary.** Anyone can self-host the platform; modifications deployed as a network service must publish their source under the same license. Today nothing on the maintainer's hosted instance (`vidit.app`) is paid. The analyst-facing platform is, and will stay, free; if the hosted instance ever charges for anything, it will be surfaces aimed at consumers of the community's work (alert webhooks, larger exports), never at the analysts producing it. Details in [`planning/roadmap.md`](planning/roadmap.md) → *Openness & transparency*.

---

## Demo

<!--
Embed source: the README variant rendered by `make promo` (1280×720,
~1.6 MB), uploaded as a GitHub user-attachment so the player renders
inline on github.com. To swap in a re-render: drag the new
`video/out/promo-readme.mp4` into any GitHub draft comment textarea,
copy the `https://github.com/user-attachments/assets/<uuid>` URL it
generates, and replace the URL on the bare line below; leaving the
URL alone on its own line is what triggers GitHub's auto-player.
The hero on [vidit.app](https://vidit.app) plays the matching 2K
master (10 MB) from CloudFront.
-->

https://github.com/user-attachments/assets/8b3689a9-b840-4ffb-8e91-21aef1aaca48

---

## Tech stack at a glance

| Layer | Choice |
|-------|--------|
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2 + GeoAlchemy2 + Alembic |
| Database | PostgreSQL + PostGIS 3 (16 in prod, 18 locally) |
| Auth | Cookie session + double-submit CSRF (JWT payload, PyJWT) + bcrypt + invite codes |
| Storage | AWS S3 + CloudFront (media) |
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind |
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
├── frontend/         Next.js 16 app (npm)
│   └── src/
│       ├── app/         App Router pages
│       ├── components/
│       ├── contexts/    React context providers (auth, map state)
│       ├── hooks/
│       ├── lib/
│       ├── types/
│       └── proxy.ts     default-deny auth + host canonicalisation
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

The technical reference is also hosted at **[docs.vidit.app](https://docs.vidit.app)** (MkDocs Material build of [`docs/`](docs/)).

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
make dev-worker  # archive-import worker (optional; without it, archive uploads stay queued)
make test        # backend pytest
```

`make help` lists every target individually.

### Prerequisites

- Docker (for PostgreSQL + PostGIS; prod runs PG 16 on Railway, local is PG 18, see [`docs/backups.md`](docs/backups.md) for restore implications)
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

- **Database connection failed**: ensure `docker-compose up -d` is running and nothing else holds port 5432.
- **Frontend can't reach the API**: check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` is `http://localhost:8000/api/v1`.
- **"Module not found"**: re-run `uv sync` (backend) / `npm install` (frontend), or `make install` for both.

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

The demo content shipped on the landing video and in the seed requests uses real geolocation work from [`@geo27752`](https://x.com/geo27752), reproduced with their consent. Thanks for letting Vidit show the platform the way analysts actually use it.
