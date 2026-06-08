# Engineering

Tech stack, repo layout, local environment, deployment, particularities.

---

## Tech stack

### Selection principles

- **Open source first** — every component must be self-hostable or replaceable
- **Python backend** — matches the team's profile (data engineering)
- **Near-zero cost during the beta** — 10 users, no reason to pay

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
| RDBMS | **PostgreSQL** (16 in prod on Railway, 18 locally — see [`backups.md`](backups.md) for the version-mismatch rationale) |
| Geospatial extension | **PostGIS 3** |

PostGIS handles coordinates, bounding boxes, and geographic queries (radius, intersection…).

### Media storage

| Component | Choice |
|-----------|--------|
| Object storage | **AWS S3** (private bucket, eu-west region) |
| CDN | **AWS CloudFront** (with Origin Access Control) |
| Python SDK | `boto3` |

S3 + CloudFront from day one (not Supabase). AWS familiarity, evidence-preservation primitives (Object Lock, versioning, replication), no future migration tax. The backend talks to storage through a small `Storage` protocol (`S3Storage` for prod, `LocalStorage` for dev/CI). Shipped in v0.0.2 — see [`CHANGELOG.md`](CHANGELOG.md).

### Frontend

| Component | Choice |
|-----------|--------|
| Framework | **Next.js 14** (App Router) |
| Language | **TypeScript** |
| Interactive map | **MapLibre GL JS** (via `react-map-gl/maplibre`) + **CARTO Dark Matter** vector tiles |
| Rich editor (proof) | **Tiptap** |
| Styles | **Tailwind CSS** |
| Icons | **lucide-react** |

MapLibre GL JS is open-source (BSD-3-Clause), uses vector tiles, and supports client-side clustering. CARTO Dark Matter tiles are free for non-commercial use and visually align with the dark theme.

### Hosting

| Service | Platform | Estimated cost |
|---------|----------|----------------|
| Backend (FastAPI) | **Railway** | ~0–5 €/month |
| Frontend (Next.js) | **Vercel** | Free |
| Database (PostgreSQL + PostGIS) | **Railway** | Included in the plan |
| Media storage | **AWS S3 + CloudFront** | ~1–3 $/month at beta scale |

**Beta total (10 users): ~5 €/month.**

### Out of technical scope for the MVP

- Redis / external cache — not needed (an in-process TTL+LRU cache is used for the points endpoint, see `backend/app/cache.py`)
- Task queue (Celery, etc.) — no async processing in the MVP
- Multi-region S3 / cross-region replication — single-region for closed beta
- Monitoring / observability — UptimeRobot liveness checks on the API health endpoint + a Sentry SDK on both tiers (backend + frontend), opt-in via a DSN env var (shipped v0.1.0 — see [Observability](#observability--whats-wired-and-how-to-turn-it-on)). No full APM / tracing pipeline yet.

---

## Repository layout (monorepo)

```
vidit/
├── AGENTS.md
├── CHANGELOG.md                    # release history (append-only)
├── CLAUDE.md                       # one-line `@AGENTS.md` pointer for Claude Code
├── CODE_OF_CONDUCT.md              # Contributor Covenant 2.1
├── CONTRIBUTING.md                 # PR flow, doc-sync rule, commit conventions
├── LICENSE                         # AGPL-3.0
├── Makefile                        # init / dev / seed / mock-admin / test entry points
├── README.md
├── SECURITY.md                     # vulnerability reporting
├── docker-compose.yml              # PostgreSQL + PostGIS for local dev
├── docker/                         # custom PG 18 image (PostGIS + AGE + pg_cron) + backup cron
│
├── backend/                        # FastAPI (Python)
│   ├── app/
│   │   ├── main.py                 # FastAPI entry point
│   │   ├── config.py               # Settings (pydantic-settings)
│   │   ├── database.py             # SQLAlchemy engine + session
│   │   ├── cache.py                # In-process TTL + LRU cache
│   │   ├── dependencies.py         # get_db, get_current_user
│   │   ├── middleware/             # HSTS, request-context, CSRF, gate
│   │   ├── models/                 # SQLAlchemy — one table per file
│   │   │   ├── admin_event.py      # Admin-action audit log
│   │   │   ├── auth_event.py       # /auth/* audit log
│   │   │   ├── auth_token.py       # Single-use password-reset tokens
│   │   │   ├── bounty.py           # Bounty + BountyClaim (multi-claimer signal)
│   │   │   ├── follow.py           # Analyst → analyst follow edges
│   │   │   ├── geolocation.py
│   │   │   ├── invite_code.py
│   │   │   ├── media.py
│   │   │   ├── pending_registration.py  # Pre-creation registration staging
│   │   │   ├── proof_image.py      # Inline images uploaded from the Tiptap proof editor
│   │   │   ├── tag.py
│   │   │   └── user.py
│   │   ├── schemas/                # Pydantic v2 — request/response
│   │   │   ├── admin.py
│   │   │   ├── auth.py
│   │   │   ├── bounty.py
│   │   │   ├── geolocation.py
│   │   │   ├── media.py
│   │   │   ├── recovery.py         # Password-reset request/confirm bodies
│   │   │   ├── search.py
│   │   │   ├── tag.py
│   │   │   └── user.py
│   │   ├── routers/                # FastAPI endpoints
│   │   │   ├── admin.py
│   │   │   ├── auth.py
│   │   │   ├── bounties.py
│   │   │   ├── geolocations.py
│   │   │   ├── search.py
│   │   │   ├── social.py           # Follow / unfollow / timeline
│   │   │   ├── tags.py
│   │   │   └── users.py
│   │   └── services/               # Business logic
│   │       ├── admin.py            # Invite mint, trust toggle, soft/hard delete
│   │       ├── audit.py            # auth_events + admin_events writes
│   │       ├── auth.py             # JWT, hashing, invite-code consume (atomic UPDATE)
│   │       ├── auth_cookies.py     # Session + CSRF cookie issuance / clearing
│   │       ├── auth_tokens.py      # Single-use password-reset tokens
│   │       ├── email.py            # Resend / console-echo email transport
│   │       ├── evidence_processing.py  # EXIF strip + sha256 hash on upload
│   │       ├── maintenance.py      # Reapers: auth tokens, proof orphans, pending regs
│   │       ├── registration.py     # Pre-creation flow: pending row, claim, confirm
│   │       ├── sanitize.py         # Server-side Tiptap (ProseMirror) sanitiser
│   │       ├── search.py           # ts_headline-driven highlight pipeline
│   │       ├── seed.py             # Admin demo-data seeder
│   │       ├── social.py           # Follow edges, timeline assembly
│   │       └── storage.py          # Storage protocol + S3Storage / LocalStorage
│   ├── alembic/                    # DB migrations
│   ├── scripts/                    # Local-dev helpers (mock_admin, seed_demo, seed_timeline)
│   ├── tests/
│   ├── alembic.ini
│   ├── pyproject.toml              # uv + dependencies
│   └── Dockerfile
│
├── frontend/                       # Next.js 14 (TypeScript)
│   ├── src/
│   │   ├── app/                    # App Router
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx            # Public landing page (storefront)
│   │   │   ├── about/              # Public marketing / mission page
│   │   │   ├── admin/              # Admin console (invites, demo seed, reapers)
│   │   │   ├── bounties/           # Bounty index + detail + create
│   │   │   ├── geolocations/       # Detail + submit form
│   │   │   ├── map/                # Interactive map (the app home)
│   │   │   ├── profile/[username]/ # Analyst profile
│   │   │   ├── search/             # Global search
│   │   │   ├── settings/           # User settings
│   │   │   ├── timeline/           # Following-feed
│   │   │   ├── (auth)/             # Login, register, forgot, etc. (sidebar hidden)
│   │   │   ├── error.tsx           # Route-level error boundary
│   │   │   └── global-error.tsx    # Root error boundary
│   │   ├── components/
│   │   │   ├── auth/               # LoginForm, RegisterForm, etc.
│   │   │   ├── editor/             # Tiptap components
│   │   │   ├── geolocation/        # GeolocationCard, etc.
│   │   │   ├── map/                # MapLibre GL components
│   │   │   ├── profile/            # TrustBadge, etc.
│   │   │   ├── ui/                 # PageShell, styles.ts, WipBadge, etc.
│   │   │   ├── ClosedBetaBanner.tsx
│   │   │   ├── PathTracker.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── contexts/AuthContext.tsx
│   │   ├── hooks/                  # useAdmin, etc.
│   │   ├── lib/                    # api.ts, auth.ts, mediaUrls.ts, format.ts, …
│   │   ├── types/index.ts          # Shared types
│   │   └── middleware.ts           # Host redirect + auth wall (Edge runtime)
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── next.config.mjs
│
├── docs/                          # technical reference
│   ├── api.md
│   ├── backups.md              # weekly pg_dump cron + restore drill
│   ├── data-model.md
│   ├── design.md
│   └── engineering.md          # tech stack + repo layout + deployment + particularities
│
├── planning/                       # project planning (not user docs)
│   ├── next.md                 # scheduled work + unscheduled candidates
│   └── roadmap.md              # vision + openness commitment
│
├── video/                          # "Promo as code" pipeline — see video/README.md
│   ├── src/                        # Remotion composition (Demo.tsx) + components
│   ├── seed-bounties.js            # Seeds bounty list from analyst tweets (idempotent)
│   ├── record-submit.js            # Playwright + DOM cursor overlay → recording-submit.mp4
│   ├── package.json                # remotion + playwright deps
│   └── README.md                   # Operator guide + brittleness notes
│
└── .github/
    └── workflows/
        ├── backend.yml
        ├── dco.yml                 # every commit needs Signed-off-by (DCO 1.1)
        ├── deploy.yml              # manual workflow_dispatch (railway up / vercel deploy)
        ├── docs-pairing.yml        # PR must touch docs/ AND planning/
        ├── frontend.yml
        └── pr-title.yml
```

---

## Backend — conventions

### Layered structure

```
HTTP request → router → service → model / DB
                 ↕         ↕
              schema    database.py
           (validation) (session)
```

| Layer | Role | Rule |
|-------|------|------|
| **routers/** | HTTP endpoints, no business logic | Calls a service, returns a schema |
| **services/** | Business logic | Accesses the DB through the session, never sees `Request`/`Response` |
| **models/** | SQLAlchemy tables | No logic — just structure |
| **schemas/** | Pydantic validation | Input and output separated (`Create`, `Read`, `Update`, `List`) |
| **dependencies.py** | FastAPI injection | `get_db`, `get_current_user` |

### Schema naming

```
GeolocationCreate   → POST input
GeolocationUpdate   → PATCH input
GeolocationRead     → output (API response)
GeolocationList     → simplified output (map, lists)
```

---

## Local environment

### Docker Compose

`docker-compose.yml` spins up a custom PostgreSQL image (`docker/Dockerfile`) bundling PostGIS, Apache AGE, and pg_cron. The two preloaded extensions need `shared_preload_libraries = 'age, pg_cron'` baked into `postgresql.conf` at image-build time — appended to `postgresql.conf.sample` in [`docker/Dockerfile`](../docker/Dockerfile) since the stock `postgres` image doesn't honour `POSTGRES_SHARED_PRELOAD_LIBRARIES`. Container `vidit-db`; data volume mounted at `/var/lib/postgresql` (not `/data`) so AGE catalog state persists across restarts.

The backend (FastAPI via uvicorn) and the frontend (Next.js dev server) run on the host for hot reload.

```
docker-compose up -d        → PostgreSQL on :5432
uv run uvicorn ...          → backend on :8000
npm run dev                 → frontend on :3000
```

### Environment variables

Each service has its own `.env` (not committed):

- `backend/.env` — `DATABASE_URL`, `JWT_SECRET`, `STORAGE_BACKEND` (`local` or `s3`), `S3_BUCKET`, `AWS_REGION`, `CLOUDFRONT_DOMAIN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CORS_ORIGINS`. Full list in `backend/.env.example`.
- `frontend/.env.local` — `NEXT_PUBLIC_API_URL`. Full list in `frontend/.env.local.example`.

### Running multiple frontends against one backend

The local CORS allowlist accepts every `localhost:<port>` (http or https) by default — see [`backend/app/config.py`](../backend/app/config.py) (`cors_origin_regex`). One backend on `:8000` serves any number of concurrent frontends (main checkout, worktrees, alternate ports) without restart. For a frontend on a non-default port:

```
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 npx next dev -p 3030
```

The override is *only* the localhost regex — explicit `CORS_ORIGINS` (production hosts) still apply. Auth cookies are domain-scoped, so this is safe in prod: a page at `localhost:N` in a real user's browser can't include `.vidit.app` cookies in a request to `api.vidit.app` even if CORS lets the request through.

In prod, set `CORS_ORIGIN_REGEX=` (empty) in Railway env vars to drop the localhost allowance — cookie scoping already prevents real attacks, but it keeps the public CORS surface tight.

---

## CI/CD

### GitHub Actions

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `backend.yml` | Push (when `backend/` changes) | `uv sync` → `ruff check` → `ruff format --check` → `mypy app` → `alembic upgrade head` → `pytest` |
| `frontend.yml` | Push (when `frontend/` changes) | `npm ci` → `eslint` → `tsc --noEmit` → `next build` |
| `docs-pairing.yml` | PR to `main` | Fails the PR when it doesn't touch *both* `docs/` (api / data-model / engineering / design / backups) AND `planning/` (`next.md` or `roadmap.md`). Friction-first guardrail: if the change genuinely needs neither, override with a justification in the PR description. Renamed from the previous `doc-sync.yml` (which had ~5 granular path-pairing rules) because the workflow's GitHub registration got stuck after a large rewrite and only a rename forced a fresh record. |
| `pr-title.yml` | PR opened / synchronized | Validates the PR title against Conventional Commits. |
| `dco.yml` | PR opened / edited / synchronized / reopened | Walks every commit on the PR and fails when any lacks a `Signed-off-by:` trailer. Implements [DCO 1.1](https://developercertificate.org) — **not** a CLA, no relicensing, inbound = outbound = AGPL-3.0. Self-contained shell script (no third-party action, so a silent tag-republish on a vendor action can't substitute its own check semantics). Merge commits are skipped so a mid-flight `git pull` doesn't false-positive the auto-generated subject. |
| `deploy.yml` | `workflow_dispatch` | See [Deployment](#deployment) below. |

Hardening (forks make every workflow run attacker-reachable):

- **Every third-party action is SHA-pinned**, with the human-readable version in a trailing comment.
- **Every workflow declares a top-level `permissions:` block** scoped to the minimum it needs (`contents: read` for the five CI workflows, `pull-requests: read` on `pr-title.yml`).
- **No workflow uses `pull_request_target`** — fork-PR escalation vector. Stick to `pull_request`.

### Deployment

| Service | Platform | Identifier | Method |
|---------|----------|------------|--------|
| Source | GitHub | [`github.com/vidithq/vidit`](https://github.com/vidithq/vidit) — public, AGPL-3.0. Cross-linked from the landing roadmap card, the `/about` AGPL paragraph, and the sidebar header (next to the X + Discord shortcuts). | Direct push to feature branches; `main` is branch-protected, every change lands via PR. |
| Backend | Railway | project `vidit` / service `backend` — public host `https://api.vidit.app` (Railway-internal `backend.railway.internal`) | Dockerfile build, deployed via the [`deploy` workflow](../.github/workflows/deploy.yml) (`workflow_dispatch`). Auto-deploy on push to `main` is **off**. `railway up` from `backend/` works as a manual fallback. |
| Frontend | Vercel | team `vidithq` / project `vidit-frontend` — primary domain `https://vidit.app` (apex), `www.vidit.app` 308-redirects at the Vercel domain layer; `vidit-frontend.vercel.app` and any other non-canonical host 308-redirects at the Next.js middleware layer ([`frontend/src/middleware.ts`](../frontend/src/middleware.ts)) so the project alias doesn't accumulate duplicate-content surface in search. | Deployed via the [`deploy` workflow](../.github/workflows/deploy.yml) (`workflow_dispatch`) using `vercel pull` + `vercel build` + `vercel deploy --prebuilt --prod`. `vercel --prod` from `frontend/` works as a manual fallback. Per-deployment hash URLs are SSO-walled; only the project alias is public. |
| DNS | Cloudflare | `vidit.app` zone, **DNS-only** (gray cloud) | Apex + `www` A → Vercel `76.76.21.21`; `api` CNAME → Railway. Proxy mode (orange cloud) breaks Let's Encrypt cert provisioning. |
| Database | Railway | managed Postgres + PostGIS, service `postgres-db` (image `postgis/postgis:16-3.4`) | `DATABASE_URL` (with internal `*.railway.internal` host) is auto-injected onto the **`backend`** service when the DB is attached. New consumers wire it as `${{backend.DATABASE_URL}}`. Public networking is **off** — admin scripts run inside the backend container via `railway ssh --service backend`. |
| Migrations | Railway | — | Pre-deploy hook: `uv run alembic upgrade head` (in [`backend/railway.json`](../backend/railway.json)). Runs *before* the new container takes traffic. |
| Media | AWS | bucket `<media-bucket>` (region `eu-west-3`), CloudFront `d10w3bld05vsky.cloudfront.net` (OAC, not OAI). Versioning ON; Object Lock ON with default rule GOVERNANCE / 365 days (bucket-wide — see CHANGELOG `Unreleased`); CORS `GET`/`HEAD` from `https://vidit.app`. Every image upload lands **three** sibling objects: the original (post EXIF-strip), `<key>_hero.jpg` (max-dim 1280, JPEG q80), `<key>_thumb.jpg` (max-dim 400, JPEG q80). Frontend renderers derive the hero / thumbnail URL from `Media.storage_url` via [`frontend/src/lib/mediaUrls.ts`](../frontend/src/lib/mediaUrls.ts) — keep that helper and the backend `derivative_key()` in [`backend/app/services/storage.py`](../backend/app/services/storage.py) in sync. | Backend uploads via `boto3` as IAM user `<runtime-iam-user>` (object-level perms only); bucket-level admin uses a separate `<s3-admin>` IAM principal. CloudFront serves the bucket. |
| Backups | Railway + AWS | Cron service `backend-backup` (image [`docker/backup/`](../docker/backup/), `0 0 * * MON` — Monday 00:00 UTC) → bucket `<backup-bucket>` (region `eu-west-3`). Versioning ON, SSE-S3, all public access blocked. Lifecycle: current objects expire 365d, noncurrent versions 30d, aborted multipart uploads 7d. | Writes through IAM user `<backup-iam-user>` with **write-only** S3 permissions (`PutObject`/`AbortMultipartUpload`/`ListMultipartUploadParts`) on the backup bucket — no `Get`, no `Delete`. Restore reads use the `<s3-admin>` profile, never the runtime user. Full runbook + restore drill: [`backups.md`](backups.md). |

Naming: `<product>-<env>-<region>` for the bucket so a future `vidit-staging-eu-west-3` slots in. Service is just `backend` because Railway already nests it under `vidit/production`. Vercel project is `vidit-frontend` because the team scope is `vidithq`.

### Operating the platform — CLIs

Railway:

```bash
brew install railway
railway login           # browser auth, saved per machine
railway link            # interactive: pick project → environment → service (writes .railway/)
railway status          # what's currently linked
railway variables                                # list
railway variables --set "KEY=value"              # add/update; triggers redeploy
railway up [--detach]                            # build + deploy from cwd
railway logs [--build]                           # tail running deployment / latest build
railway run -- <command>                         # run a one-off in the service env
```

Vercel:

```bash
brew install vercel-cli
vercel login                                      # interactive — but see Keychain quirk below
vercel link --yes --scope vidithq --project vidit-frontend
vercel env ls
printf 'value' | vercel env add NAME production   # pipe avoids leaking via ps/history
vercel --prod --yes                               # promote to production
```

Vercel **Keychain quirk**: CLI ≥ 32 stores tokens in macOS Keychain; the `auth.json` file only contains `{}`. A sandboxed shell without Keychain access can't see credentials saved by `vercel login` and triggers a fresh device-auth flow on every invocation. Workaround for headless use: generate at https://vercel.com/account/tokens, then `export VERCEL_TOKEN=…` and pass `--token="$VERCEL_TOKEN" --scope vidithq` on every command.

`--scope` is required in non-interactive shells (no default team).

`NEXT_PUBLIC_*` env vars are baked into the JS bundle at build time. `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_DEMO_VIDEO_URL` (the landing demo video — a CloudFront `.mp4` URL) are passed explicitly into the build from repo **variables** in [`deploy.yml`](../.github/workflows/deploy.yml), because `vercel pull` doesn't reliably surface `NEXT_PUBLIC_*` to `next build`.

### Observability — what's wired and how to turn it on

| Piece | State | How to turn on |
|---|---|---|
| Backend Sentry | SDK wired in [`backend/app/main.py`](../backend/app/main.py) — `sentry_sdk.init(...)` runs only when `SENTRY_DSN` is non-empty. | Create a project at sentry.io (Python / FastAPI), copy the DSN, then on Railway `backend` service: `railway variables --set "SENTRY_DSN=https://..." --set "SENTRY_ENVIRONMENT=production"`. Verify: hit a 5xx path or `sentry_sdk.capture_message('hello')` from `railway ssh` and confirm it lands. |
| Frontend Sentry | SDK wired in [`frontend/sentry.client.config.ts`](../frontend/sentry.client.config.ts) + [`sentry.server.config.ts`](../frontend/sentry.server.config.ts) + [`sentry.edge.config.ts`](../frontend/sentry.edge.config.ts); booted by [`frontend/instrumentation.ts`](../frontend/instrumentation.ts) + the auto-injected client entry. `Sentry.init(...)` runs only when `NEXT_PUBLIC_SENTRY_DSN` (client) or `SENTRY_DSN` (server / edge) is non-empty. `app/error.tsx` + `app/global-error.tsx` forward caught exceptions via `Sentry.captureException` (React error boundaries are not auto-captured). `next.config.mjs` is wrapped with `withSentryConfig`. | On Vercel set `NEXT_PUBLIC_SENTRY_DSN` (Production) + `SENTRY_DSN` (server runtime) + `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production` + `SENTRY_ENVIRONMENT=production`. For build-time source-map upload also add repo variables `SENTRY_ORG` + `SENTRY_PROJECT` + repo secret `SENTRY_AUTH_TOKEN` ([wired through `deploy.yml`](../.github/workflows/deploy.yml)) and set the same on Vercel. Trigger a `deploy` workflow run. Verification: see [Frontend Sentry verification](#frontend-sentry-verification) below. |
| Uptime monitor | External. Pings `/health` from outside Railway region to catch outages. | Pick a free tier (UptimeRobot, BetterStack, Hyperping). Add `https://api.vidit.app/health` as an HTTP monitor, 1–5 min cadence, alert routes to owner email + the Vidit Discord webhook. Health endpoint is unauthenticated and returns `{"status":"ok"}`. |
| CloudWatch budget alarm | External. $20/mo guardrail against a forgotten log-volume spike or a runaway CloudFront-cache-miss bill. | AWS console → Billing → Budgets → Create budget → Cost budget, monthly $20 fixed amount, threshold 80% actual + 100% forecasted → email alert to owner. |
| Branch protection on `main` | External — requires GitHub Pro on private repos. | GitHub → Settings → Branches → Add rule for `main`: require PR review (1), require CI green (`backend.yml` + `frontend.yml` + `docs-pairing.yml` + `pr-title.yml` + `dco.yml`), disallow force-push, disallow deletion. |

### Frontend Sentry verification

Drilled 2026-05-18. In an incognito window (extensions disabled):

- (a) **Browse a few pages** and check **sentry.io → your project → Sessions** for ticks within ~1 min. Session tracking emits an envelope per page load — no console action needed.
- (b) For an explicit issue, run `setTimeout(() => { throw new Error("manual test") }, 0)` in DevTools. The `setTimeout` matters: a synchronous `throw` from the console is swallowed by the DevTools wrapper and never reaches `window.onerror`. The SDK doesn't expose `Sentry` on `window` in 10.x, so `Sentry.captureMessage(...)` from the console errors with `Sentry is not defined`.

**Ad-blocker caveat.** uBlock, Brave shields, AdGuard, and most browser tracking-protection lists block direct POSTs to `*.ingest.sentry.io` with `ERR_BLOCKED_BY_CLIENT`. The fix is `tunnelRoute: "/monitoring"` in `withSentryConfig`, which proxies envelopes through a same-origin route — not yet wired.

### Maintenance runbooks

**Mint an invite code from the host**:

```bash
railway ssh --service backend -- python <<'EOF'
import os, secrets, string
from datetime import UTC, datetime, timedelta

from app.database import SessionLocal
from app.models.invite_code import InviteCode

alphabet = string.ascii_uppercase + string.digits
code = "".join(secrets.choice(alphabet) for _ in range(12))
db = SessionLocal()
try:
    row = InviteCode(
        code=code,
        max_uses=1,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        note="break-glass",
    )
    db.add(row)
    db.commit()
    print(f"invite code: {code} (expires in 7d, 1 use)")
finally:
    db.close()
EOF
```

**Generate curated demo geolocations from the admin panel**: `make seed` covers the auto-generated 50-point dataset for onboarding. For curated demos (promo recordings, screenshots, manually-themed content), populate `s3://<bucket>/demo-pool/geo-XX/{media,proof}/` (or `.local-storage/demo-pool/geo-XX/{media,proof}/` when `STORAGE_BACKEND=local`) with photos per template, then go to `/admin` → *Demo data* panel → enter a count → Generate. Seeded geos carry a `demo` tag for filtering; the same panel wipes them.

**Clean up an orphan Railway domain** (e.g. an auto-generated `*.up.railway.app` host — leaks the project name to scanners):

```
Railway dashboard → project `vidit` → service `postgres-db` → Settings → Networking
→ remove any public domain that isn't actively in use
```

Public networking on `postgres-db` is off. Delete any public domain with no `DATABASE_PUBLIC_URL` consumer.

### Particularities (non-obvious things that bit us)

- **`postgres://` → `postgresql://`** — Railway injects the legacy scheme; SQLAlchemy 2 only loads under `postgresql://`. We string-prefix swap in [`backend/app/config.py`](../backend/app/config.py) `_normalize_postgres_scheme`. Fix landed in [PR #21](https://github.com/vidithq/vidit/pull/21).
- **`$PORT` not expanded in `railway.json`'s `startCommand`** — Railway passes the literal string `$PORT`. Fix: drop `startCommand` and let the Dockerfile `CMD ["sh", "-c", "… --port ${PORT:-8000}"]` expand it. See [PR #22](https://github.com/vidithq/vidit/pull/22).
- **`CORS_ORIGINS` is a comma-separated string**, not pydantic's default JSON list. Property `cors_origins_list` parses it. The deployed Vercel alias must be in the list or browser calls fail at preflight. See [PR #23](https://github.com/vidithq/vidit/pull/23).
- **`COOKIE_DOMAIN` must be `.vidit.app` in prod** — the `vidit_csrf` cookie is set by `api.vidit.app` but read by JavaScript at `vidit.app`. Without the parent-domain scope (`COOKIE_DOMAIN=.vidit.app` on the Railway `backend` service) the double-submit CSRF check can't see the token and **every mutating request fails** with `CSRF token missing or invalid`.
- **Two `gh` accounts on the same machine drift** — symptom is `Repository not found` on `git fetch` for a repo you can normally access. Fix: `gh auth status` then `gh auth switch --user <correct-account>`. `gh` configures git's credential helper.
- **The Vercel bundle stays up during a backend outage** — static JS loads from Vercel CDN regardless of Railway state. When investigating "the site is broken", check `/health` on Railway first.
- **uvicorn needs `--proxy-headers` behind Railway, AND nothing may read `request.client.host` for security purposes** — without `--proxy-headers --forwarded-allow-ips='*'` (set in the Dockerfile's `CMD`), `request.url.scheme` defaults to `http` and absolute URLs in emails go out broken. With those flags, however, uvicorn populates `request.client.host` from the **left-most** entry of `X-Forwarded-For` (uvicorn's `always_trust=True` branch returns `x_forwarded_for_hosts[0]`). Railway *appends* to `X-Forwarded-For` rather than overwriting it, so the left-most entry is whatever the client sent — fully attacker-controlled. The two callers that need a trustworthy client IP — the slowapi rate limiter and the auth-events audit log — both route through [`services/audit.py::extract_client_ip`](../backend/app/services/audit.py), which parses XFF itself and picks the **right-most** entry (the one the trusted proxy actually wrote). The slowapi side specifically uses the `rate_limit_key` wrapper (same module) as its `key_func`. Without that, an attacker could rotate `X-Forwarded-For: <random>` to mint a fresh per-IP rate-limit bucket per request, or send `X-Forwarded-For: <victim_ip>` to pin a victim's bucket and lock them out — defeating every per-endpoint rate limit. **Never read `request.client.host` directly for rate-limit, auth, or audit purposes**; reach for `extract_client_ip` / `rate_limit_key`. If a second trusted proxy ever sits in front of Railway (Cloudflare, etc.), bump `TRUSTED_PROXY_HOPS` to match — `extract_client_ip` peels one extra hop per increment.

---

## Package management

| Service | Tool | File |
|---------|------|------|
| Backend | **uv** | `pyproject.toml` + `uv.lock` |
| Frontend | **npm** | `package.json` + `package-lock.json` |
