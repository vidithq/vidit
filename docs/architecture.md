# Architecture

## Repository layout (monorepo)

```
vidit/
├── CLAUDE.md
├── README.md
├── Makefile                        # init / dev / seed / mock-admin / test entry points
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
├── CHANGELOG.md                    # what shipped per release
├── docs/
│   ├── api.md
│   ├── architecture.md
│   ├── backups.md              # weekly pg_dump cron + restore drill
│   ├── data-model.md
│   ├── design.md
│   ├── next.md                 # scheduled work + unscheduled candidates
│   ├── roadmap.md              # 4 phases, forward-looking
│   ├── stack.md
│   └── vision.md
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
        ├── deploy.yml              # manual workflow_dispatch (railway up / vercel deploy)
        ├── doc-sync.yml            # routers↔api.md, models↔data-model.md, etc.
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

`docker-compose.yml` at the repo root spins up a custom PostgreSQL image (`docker/Dockerfile`) bundling PostGIS, Apache AGE (graph), and pg_cron. The two preloaded extensions need `shared_preload_libraries = 'age, pg_cron'` baked into `postgresql.conf` at image-build time — done in [`docker/Dockerfile`](../docker/Dockerfile) by appending the directive to `postgresql.conf.sample`. The stock `postgres` image doesn't honour a `POSTGRES_SHARED_PRELOAD_LIBRARIES` env var (a `docker-compose.yml` entry by that name would be a silent no-op). The container is named `vidit-db` and the data volume is mounted at `/var/lib/postgresql` (not just `/data`) so AGE catalog state persists across restarts.

The backend (FastAPI via uvicorn) and the frontend (Next.js dev server) run directly on the host so hot reload works without friction.

```
docker-compose up -d        → PostgreSQL on :5432
uv run uvicorn ...          → backend on :8000
npm run dev                 → frontend on :3000
```

### Environment variables

Each service has its own `.env` (not committed):

- `backend/.env` — `DATABASE_URL`, `JWT_SECRET`, `STORAGE_BACKEND` (`local` or `s3`), `S3_BUCKET`, `AWS_REGION`, `CLOUDFRONT_DOMAIN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CORS_ORIGINS`. Full list in `backend/.env.example`.
- `frontend/.env.local` — `NEXT_PUBLIC_API_URL`. Full list in `frontend/.env.local.example`.

---

## CI/CD

### GitHub Actions

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `backend.yml` | Push (when `backend/` changes) | `uv sync` → `ruff check` → `ruff format --check` → `mypy app` → `alembic upgrade head` → `pytest` |
| `frontend.yml` | Push (when `frontend/` changes) | `npm ci` → `eslint` → `tsc --noEmit` → `next build` |
| `doc-sync.yml` | PR to `main` | Fails the PR when production code moves without the paired doc update (routers ↔ `api.md`, models/migrations ↔ `data-model.md`, deploy/infra ↔ this doc, any production code ↔ `CHANGELOG.md`). Rules are tuned to past drift, not theory. |
| `pr-title.yml` | PR opened / synchronized | Validates the PR title against Conventional Commits. |
| `deploy.yml` | `workflow_dispatch` | See [Deployment](#deployment) below. |

Path filters keep each workflow scoped to its own service.

Hardening posture (sequenced for the M2 open-source flip, since public forks make every workflow run an attacker-reachable surface):

- **Every third-party action is SHA-pinned**, not tag-pinned, with the human-readable version in a trailing comment for review. Floating `@v4` / `@v5` tags would let a republished tag silently swap our build steps; commit SHAs are immutable. Bump cadence: re-resolve and bump in a dedicated PR per action, not opportunistically in feature PRs.
- **Every workflow declares a top-level `permissions:` block** scoped to the minimum it needs (`contents: read` for the four CI workflows, `pull-requests: read` on `pr-title.yml`). Without this, the workflow `GITHUB_TOKEN` ships with the repo's default broad scope.
- **No workflow uses `pull_request_target`** — that trigger runs in the base-branch context with write access and is the classic vector for fork-PR escalation. Stick to `pull_request` (read-only fork context) unless a future workflow has an explicit reason to need the elevated trigger, and document that reason next to the line if so.

### Deployment

| Service | Platform | Identifier | Method |
|---------|----------|------------|--------|
| Backend | Railway | project `vidit` / service `backend` — public host `https://api.vidit.app` (Railway-internal `backend.railway.internal`) | Dockerfile build, deployed via the [`deploy` workflow](../.github/workflows/deploy.yml) (`workflow_dispatch`). Auto-deploy on push to `main` is **off** during closed beta. `railway up` from `backend/` still works as a manual fallback. |
| Frontend | Vercel | team `vidithq` / project `vidit-frontend` — primary domain `https://vidit.app` (apex), `www.vidit.app` 308-redirects at the Vercel domain layer; `vidit-frontend.vercel.app` and any other non-canonical host 308-redirects at the Next.js middleware layer ([`frontend/src/middleware.ts`](../frontend/src/middleware.ts)) so the project alias doesn't accumulate duplicate-content surface in search. | Deployed via the [`deploy` workflow](../.github/workflows/deploy.yml) (`workflow_dispatch`) using `vercel pull` + `vercel build` + `vercel deploy --prebuilt --prod`. `vercel --prod` from `frontend/` still works as a manual fallback. Per-deployment hash URLs are SSO-walled; only the project alias is public. |
| DNS | Cloudflare | `vidit.app` zone, **DNS-only** (gray cloud) | Apex + `www` A → Vercel `76.76.21.21`; `api` CNAME → Railway. Proxy mode (orange cloud) breaks Let's Encrypt cert provisioning at both providers. |
| Database | Railway | managed Postgres + PostGIS, service `postgres-db` (image `postgis/postgis:16-3.4`) | `DATABASE_URL` (with internal `*.railway.internal` host) is auto-injected onto the **`backend`** service when the DB is attached — it lives there, not on `postgres-db`. New consumers wire it as `${{backend.DATABASE_URL}}`. Public networking is **off** — admin scripts run inside the backend container via `railway ssh --service backend`. |
| Migrations | Railway | — | Pre-deploy hook: `uv run alembic upgrade head` (in [`backend/railway.json`](../backend/railway.json)). Runs *before* the new container takes traffic. |
| Media | AWS | bucket `<media-bucket>` (region `eu-west-3`), CloudFront `d10w3bld05vsky.cloudfront.net` (OAC, not OAI). Versioning ON; Object Lock ON with default rule GOVERNANCE / 365 days (bucket-wide — see CHANGELOG `Unreleased`); CORS `GET`/`HEAD` from `https://vidit.app`. Every image upload lands **three** sibling objects: the original (post EXIF-strip), `<key>_hero.jpg` (max-dim 1280, JPEG q80), `<key>_thumb.jpg` (max-dim 400, JPEG q80). Frontend renderers derive the hero / thumbnail URL from `Media.storage_url` via [`frontend/src/lib/mediaUrls.ts`](../frontend/src/lib/mediaUrls.ts) — keep that helper and the backend `derivative_key()` in [`backend/app/services/storage.py`](../backend/app/services/storage.py) in sync if you ever rename the suffix. | Backend uploads via `boto3` as IAM user `<runtime-iam-user>` (object-level perms only); bucket-level admin uses a separate `<s3-admin>` IAM principal. CloudFront serves the bucket. |
| Backups | Railway + AWS | Cron service `backend-backup` (image [`docker/backup/`](../docker/backup/), `0 0 * * MON` — Monday 00:00 UTC) → bucket `<backup-bucket>` (region `eu-west-3`). Versioning ON, SSE-S3, all public access blocked. Lifecycle: current objects expire 365d, noncurrent versions 30d, aborted multipart uploads 7d. | Writes through IAM user `<backup-iam-user>` with **write-only** S3 permissions (`PutObject`/`AbortMultipartUpload`/`ListMultipartUploadParts`) on the backup bucket — no `Get`, no `Delete`. Restore reads use the `<s3-admin>` profile, never the runtime user. `DATABASE_URL` wired as `${{backend.DATABASE_URL}}` — not `postgres-db`, which doesn't expose the variable. Full runbook + restore drill: [`docs/backups.md`](backups.md). |

Naming: `<product>-<env>-<region>` for the bucket so a future `vidit-staging-eu-west-3` slots in. Service is just `backend` because Railway already nests it under `vidit/production`. Vercel project is `vidit-frontend` because the team scope is `vidithq` (the product was renamed Vision → Vidit and the org handle `viditapp` → `vidithq` in v0.0.2 — see [`CHANGELOG.md`](../CHANGELOG.md)).

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

Vercel **Keychain quirk**: CLI ≥ 32 stores tokens in macOS Keychain; the `auth.json` file only contains `{}`. A sandboxed shell without Keychain access can't see credentials saved by `vercel login` and triggers a fresh device-auth flow on every invocation (rate-limit lands fast). Workaround for headless use: generate at https://vercel.com/account/tokens, then `export VERCEL_TOKEN=…` and pass `--token="$VERCEL_TOKEN" --scope vidithq` on every command.

`--scope` is **required** in non-interactive shells; `vercel link` won't pick a default team.

`NEXT_PUBLIC_*` env vars are baked into the JS bundle at build time. Changing one on Vercel requires a fresh `vercel --prod` for browsers to see the new value.

### Observability — what's wired and how to turn it on

| Piece | State | How to turn on |
|---|---|---|
| Backend Sentry | SDK wired in [`backend/app/main.py`](../backend/app/main.py) — `sentry_sdk.init(...)` runs only when `SENTRY_DSN` is non-empty (no DSN = no boot, no PII leak). | Create a project at sentry.io (Python / FastAPI), copy the DSN, then on Railway `backend` service: `railway variables --set "SENTRY_DSN=https://..." --set "SENTRY_ENVIRONMENT=production"`. A redeploy is automatic. Verify with a one-shot exception: hit any 5xx-inducing path (or `await sentry_sdk.capture_message("hello")` from `railway ssh`) and check the issue lands in the project. |
| Frontend Sentry | SDK wired in [`frontend/sentry.client.config.ts`](../frontend/sentry.client.config.ts) + [`frontend/sentry.server.config.ts`](../frontend/sentry.server.config.ts) + [`frontend/sentry.edge.config.ts`](../frontend/sentry.edge.config.ts), booted by [`frontend/instrumentation.ts`](../frontend/instrumentation.ts) and the auto-injected client entry. `Sentry.init(...)` runs only when `NEXT_PUBLIC_SENTRY_DSN` (client) or `SENTRY_DSN` (server / edge) is non-empty. `app/error.tsx` + `app/global-error.tsx` forward caught exceptions via `Sentry.captureException` because React error boundaries are **not** auto-captured by the SDK. `next.config.mjs` is wrapped with `withSentryConfig`. | Create a project at sentry.io (Next.js platform), copy the DSN, then **on Vercel** set `NEXT_PUBLIC_SENTRY_DSN` (Production) + `SENTRY_DSN` (server runtime) + `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production` + `SENTRY_ENVIRONMENT=production`. For build-time source-map upload also add repo variables `SENTRY_ORG` + `SENTRY_PROJECT` + repo secret `SENTRY_AUTH_TOKEN` ([wired through `deploy.yml`](../.github/workflows/deploy.yml)) and set the same on Vercel. Trigger a `deploy` workflow run. **Verification (drilled 2026-05-18):** open the deployed site in an **incognito window** (extensions disabled — see ad-blocker note below), then either (a) just browse a few pages and check **sentry.io → your project → Sessions** for ticks within ~1 min — session-tracking emits an envelope on every page load, so no console action is needed; or (b) for an explicit issue, run `setTimeout(() => { throw new Error("manual test") }, 0)` from DevTools (the `setTimeout` matters — a synchronous `throw` from the console eval is swallowed by the DevTools wrapper and never reaches `window.onerror`). The SDK does **not** expose `Sentry` on `window` in 10.x, so `Sentry.captureMessage(...)` from the console errors with `Sentry is not defined` — use the `setTimeout(throw, 0)` path instead. **Ad-blocker caveat:** uBlock, Brave shields, AdGuard, and most browser tracking-protection lists block the direct POST to `*.ingest.sentry.io` with `ERR_BLOCKED_BY_CLIENT`, so errors from blocker-running visitors silently never reach Sentry. Closed-beta-acceptable (small known analyst pool, ask them to whitelist `vidit.app` if a crash needs investigating). Public-beta-grade fix is `tunnelRoute: "/monitoring"` in `withSentryConfig`, which creates a same-origin proxy route. |
| Uptime monitor | External. Pings `https://api.vidit.app/health` from outside the Railway region so we see a Railway outage before analyst #1 does. | Pick a free tier (UptimeRobot, BetterStack, Hyperping). Add `https://api.vidit.app/health` as an HTTP monitor, 1–5 min cadence, alert routes to owner email + the Vidit Discord webhook. Health endpoint is unauthenticated and returns `{"status":"ok"}` — no special config. |
| CloudWatch budget alarm | External. $20/mo guardrail against a forgotten log-volume spike or a runaway CloudFront-cache-miss bill. | AWS console → Billing → Budgets → Create budget → Cost budget, monthly $20 fixed amount, threshold 80% actual + 100% forecasted → email alert to owner. Free; cheap insurance. |
| Branch protection on `main` | External — requires GitHub Pro on private repos. | GitHub → Settings → Branches → Add rule for `main`: require PR review (1), require CI green (`backend.yml` + `frontend.yml` + `doc-sync.yml` + `pr-title.yml`), disallow force-push, disallow deletion. Cheap insurance against a stray `git push --force`. |

### Maintenance runbooks

**Mint an invite code from the host** (break-glass, e.g. the `/admin` panel is unreachable because there's no admin yet):

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

The `/admin` panel is the normal path — this snippet is for the bootstrap case (no admin yet) or a `/admin` outage.

**Clean up an orphan Railway domain** (e.g. an auto-generated `*.up.railway.app` host left over from earlier service renames — leaks the project name to scanners):

```
Railway dashboard → project `vidit` → service `postgres-db` → Settings → Networking
→ remove any public domain that isn't actively in use
```

Public networking on `postgres-db` should be **off**. If a public domain shows up that isn't load-bearing (no `DATABASE_PUBLIC_URL` consumer), delete it.

### Particularities (non-obvious things that bit us)

- **`postgres://` → `postgresql://`** — Railway injects the legacy scheme; SQLAlchemy 2 only loads under `postgresql://`. We string-prefix swap in [`backend/app/config.py`](../backend/app/config.py) `_normalize_postgres_scheme`. Fix landed in [PR #21](https://github.com/vidithq/vidit/pull/21).
- **`$PORT` not expanded in `railway.json`'s `startCommand`** — Railway passes the literal string `$PORT` to your process. Fix: drop `startCommand` and let the Dockerfile `CMD ["sh", "-c", "… --port ${PORT:-8000}"]` expand it. See [PR #22](https://github.com/vidithq/vidit/pull/22).
- **`CORS_ORIGINS` is a comma-separated string**, not pydantic's default JSON list — easier to edit in the Railway UI. Property `cors_origins_list` parses it. The deployed Vercel alias must be in the list or browser calls fail at preflight. See [PR #23](https://github.com/vidithq/vidit/pull/23).
- **`COOKIE_DOMAIN` must be `.vidit.app` in prod** — the `vidit_csrf` cookie is set by `api.vidit.app` but read by JavaScript at `vidit.app`. Without the parent-domain scope (`COOKIE_DOMAIN=.vidit.app` on the Railway `backend` service) the double-submit CSRF check can't see the token and **every mutating request fails** with `CSRF token missing or invalid`. Cross-subdomain cookie sharing is the whole reason this var exists.
- **Two `gh` accounts on the same machine drift** — symptom is `Repository not found` on `git fetch` for a repo you can normally access. Fix: `gh auth status` then `gh auth switch --user <correct-account>`. `gh` configures git's credential helper, so switching it fixes both.
- **The Vercel bundle stays up during a backend outage** — static JS loads from Vercel CDN regardless of Railway state. When investigating "the site is broken", check `/health` on Railway first to disambiguate.
- **uvicorn needs `--proxy-headers` behind Railway, AND nothing may read `request.client.host` for security purposes** — without `--proxy-headers --forwarded-allow-ips='*'` (set in the Dockerfile's `CMD`), `request.url.scheme` defaults to `http` and absolute URLs in emails go out broken. With those flags, however, uvicorn populates `request.client.host` from the **left-most** entry of `X-Forwarded-For` (uvicorn's `always_trust=True` branch returns `x_forwarded_for_hosts[0]`). Railway *appends* to `X-Forwarded-For` rather than overwriting it, so the left-most entry is whatever the client sent — fully attacker-controlled. The two callers that need a trustworthy client IP — the slowapi rate limiter and the auth-events audit log — both route through [`services/audit.py::extract_client_ip`](../backend/app/services/audit.py), which parses XFF itself and picks the **right-most** entry (the one the trusted proxy actually wrote). The slowapi side specifically uses the `rate_limit_key` wrapper (same module) as its `key_func`. Without that, an attacker could rotate `X-Forwarded-For: <random>` to mint a fresh per-IP rate-limit bucket per request, or send `X-Forwarded-For: <victim_ip>` to pin a victim's bucket and lock them out — defeating `/login` (5/min), `/register` (10/hr), `/forgot-password` (5/hr), and the global 60/min limit. **Never read `request.client.host` directly for rate-limit, auth, or audit purposes**; reach for `extract_client_ip` / `rate_limit_key`. If a second trusted proxy ever sits in front of Railway (Cloudflare, etc.), bump `TRUSTED_PROXY_HOPS` in the env vars to match — `extract_client_ip` peels one extra hop per increment.

---

## Package management

| Service | Tool | File |
|---------|------|------|
| Backend | **uv** | `pyproject.toml` + `uv.lock` |
| Frontend | **npm** | `package.json` + `package-lock.json` |
