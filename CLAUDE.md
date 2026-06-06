# Vidit — project context for AI tools

## What it is

A web platform for OSINT/GEOINT analysts to archive, reference, and visualize geolocations of armed-conflict events. Target community: international, English-speaking, active on Twitter/X and Discord.

**Status: closed beta in development.**

## Current objective

**Open source launch + wider analyst outreach.**

The closed beta is live with the first wave of analysts (auth-hardening Tiers 1, 2, 4-lite, 5 + S3 bucket hardening with versioning and Object Lock GOVERNANCE/365d + CORS `GET`/`HEAD` for `https://vidit.app` + the weekly `pg_dump` → S3 cron with a verified restore drill + the public landing and demo video — all shipped per [`CHANGELOG.md`](CHANGELOG.md) up through `v0.2.0`). The next push is the **M1 milestone** in [`docs/next.md`](docs/next.md): flip the repo public under AGPL-3.0, pin the X tweet on `@vidithq`, and cold-reach a wider analyst pool — fired as one coordinated launch so substance + code + presence arrive together and the "closed-source / vibe-coded" objection retires.

Prod operations (invite codes, trust toggle, soft/hard delete, demo data seed/wipe, maintenance reapers) live behind `/admin`. The three scripts under [`backend/scripts/`](backend/scripts/) (`mock_admin.py`, `seed_demo.py`, `seed_timeline.py`) are **local-dev helpers** wired through the `Makefile` — they don't ship to prod and aren't part of the ops surface.

When in doubt about whether a task is in scope, check `next.md` first — its three milestone tables (M1 open source launch → M2 open beta → M3 public v1) are the ordered plan.

## Strategic decisions worth knowing

These shape every feature decision. Summarised here so an AI tool reading only CLAUDE.md doesn't propose contradicting work; the longer rationale is in [`docs/roadmap.md`](docs/roadmap.md).

- **Open registration model, with a filterable trust mark on top.** **Every registered analyst has full write capabilities** — submitting geolocations, posting bounties, following other analysts. Registration: closed beta uses invite codes with pre-creation email confirmation (no `users` row until the user clicks the link — see [`backend/app/services/registration.py`](backend/app/services/registration.py)); Phase 3 opens public self-registration (CAPTCHA + honeypot + abuse defenses on the form). The `is_trusted` flag is **opt-in, admin-granted, and filterable** — it's a visible quality signal next to known-credible analysts (track record, professional credentials, established X presence) plus a `trust_reason` note explaining why. **It does not gate any capability, ever.** Readers who want a higher signal-to-noise filter to "vetted only" on the map / timeline / search. No confidence levels, no co-validation, no comments, no reputation scoring. See `roadmap.md` → *Phase 2*, *Phase 3*, and *Explicitly out of scope*.
- **Read open, write open (after registration).** Phase 3 opens the map and geolocation pages to anonymous read and lets anyone register and submit. The trust filter is the curated layer on top.
- **S3 + CloudFront from day one** for media (not Supabase). AWS familiarity, evidence-preservation primitives (Object Lock, versioning, replication), no future migration tax. Shipped in v0.0.2.
- **Security hardening is a hard gate before any second human gets access.** Shipped: front door (rate-limits, env-driven CORS, JWT-secret hard-fail), cookie session + double-submit CSRF (Bearer path removed in v0.0.9), HSTS + `auth_events` audit log, server-side Tiptap sanitisation, EXIF strip + sha256 content hashes on every upload. Deferred to public launch: 15-min access tokens + refresh tokens (Tier 3) and CSP `script-src 'self'` + `report-uri` (full Tier 4). See [`docs/next.md`](docs/next.md) → *M2 — Open beta*.

## UI conventions

The frontend has a small shared vocabulary that all in-app pages reuse. Reach for these before rolling your own — the patterns are referenced from the design docs and enforced by review:

- **Page layout — [`PageShell`](frontend/src/components/ui/PageShell.tsx).** Owns the `title` / `subtitle` / `back` slot for every in-app page. Single `max-w-4xl` column; back arrow lives in the gutter so titles align at the same x-coordinate whether back is rendered or not. Sibling `<PageCenter>` covers the loading/error pre-data state with the same sidebar offset. Pages that legitimately opt out: `/` (the public landing — its own marketing layout) and `/map` (the full-screen map), the `(auth)/*` route group, and `app/error.tsx` (the React Error Boundary lives outside the page tree). The shared `<Sidebar>` renders on all of these (it's hidden only during the initial auth load).
- **Orange palette — [`frontend/src/components/ui/styles.ts`](frontend/src/components/ui/styles.ts) (recipe in [`docs/design.md`](docs/design.md) → *Orange palette recipe*).** Single source of truth for the nine palette class strings (`PRIMARY_BUTTON`, `FILTER_CHIP_ACTIVE`/`_INACTIVE`, `TAPPABLE_HOVER`, three `STATUS_PILL_*`, `BETA_PILL`, `TAG_CHIP`). The hard rule from `design.md`: *if something looks orange and isn't clickable, it's a bug; if something is clickable and isn't orange, it's a bug.* Flat `bg-orange-500 text-white` was removed in v0.0.10 — don't reintroduce it. Constants intentionally cover only colour treatment; shape (padding, font size, width) stays at the call site.
- **"Coming soon" affordances.** Phase 2 features that aren't built yet but visible to beta testers reuse a small shared vocabulary so the affordances always read the same way:
  - [`WipBadge`](frontend/src/components/ui/WipBadge.tsx) — small white-on-dark pill, default text `Coming soon`. Pass `children` to override (the sidebar nav uses `Soon` for compactness).
  - Sidebar nav items opt into a `wip` flag (`Soon` pill in expanded mode) and a separate `notify` flag (orange dot in collapsed mode for "new content awaits"). Don't conflate the two.
  - For inline placeholders next to author handles or in panel headers, prefer a small dedicated atom like [`profile/TrustBadge.tsx`](frontend/src/components/profile/TrustBadge.tsx) over reaching for `WipBadge` directly.

## Stack

- **Backend**: FastAPI (Python 3.12) + PostgreSQL/PostGIS + SQLAlchemy/GeoAlchemy2 + Alembic
- **Auth**: cookie session (`vidit_session`, `HttpOnly; Secure; SameSite=Lax`) + double-submit CSRF (`vidit_csrf` JS-readable cookie + `X-CSRF-Token` header on mutating requests). The cookie payload is a JWT signed with PyJWT; bcrypt for password hashing. There is no `Authorization: Bearer` path — cookies are the only authenticated channel into the API (Bearer removed in v0.0.9). Invite-code registration in closed beta with pre-creation email confirmation: `POST /auth/register` stages a `pending_registrations` row + emails a confirmation link; the `users` row is created on `POST /auth/confirm-registration` when the user clicks it. Email via Resend; `EMAIL_PROVIDER=console` echoes the link to stdout for local dev. Closed-beta access model: the public surface is just the landing (`/`) and `/about`; every other page requires a session — the Next.js [`middleware`](frontend/src/middleware.ts) default-denies (dev and prod, so local matches live). There is **no** separate beta-gate cookie (removed); the invite code gates registration only. M2 opens anonymous read by adding the content routes to the middleware's public set.
- **Storage**: AWS S3 (private bucket) + CloudFront (CDN with Origin Access Control). Every upload streams through `services/evidence_processing.py` for an EXIF / IPTC / XMP strip + sha256 content hash before the bytes land in storage; provenance (`uploaded_ip`, `uploaded_user_agent`, `original_filename`) is captured on the row.
- **Frontend**: Next.js 14 (App Router, TypeScript) + Tailwind CSS
- **Map**: MapLibre GL JS (via `react-map-gl/maplibre`) + CARTO Dark Matter tiles, client-side clustering
- **Editor**: Tiptap (server-side ProseMirror sanitiser on submit — see `services/sanitize.py`)
- **Hosting**: Railway (backend + DB) + Vercel (frontend) + AWS (media)
- **Package management**: uv (backend) + npm (frontend)

Details: [`docs/stack.md`](docs/stack.md).

### Deployed environments

| Piece | Public URL | Lives in |
|---|---|---|
| Frontend | `https://vidit.app` | Vercel team `vidithq`, project `vidit-frontend` |
| Backend | `https://api.vidit.app` (`/health` 200) | Railway project `vidit`, service `backend` |
| Database | internal only | Railway-managed Postgres+PostGIS, service `postgres-db` (public networking off) |
| Media | `d10w3bld05vsky.cloudfront.net` | S3 `<media-bucket>` (eu-west-3) → CloudFront |

Auto-deploy on push to `main` is **off** during closed beta — every prod deploy is explicit via the [`deploy` workflow](.github/workflows/deploy.yml) (`workflow_dispatch`: pick a ref + target). The full deployment table (identifiers, methods, DNS, migrations, backups), the operating CLIs, and every platform gotcha we've debugged (`postgres://` scheme, `$PORT` non-expansion, `COOKIE_DOMAIN`/CSRF coupling, `NEXT_PUBLIC_*` build-time baking, `${{backend.DATABASE_URL}}` reference, Vercel Keychain auth) live in [`docs/architecture.md`](docs/architecture.md) → *Deployment*, *Operating the platform*, *Particularities*.

## Documentation

```
CHANGELOG.md        — what shipped per release (append-only)
docs/
  vision.md       — problem, persona, guiding principles
  roadmap.md      — 4 phases, forward-looking
  next.md         — milestones (scheduled) + unscheduled candidates
  design.md       — design system (philosophy, layout, components, orange-palette recipe)
  stack.md        — tech choices and rationale
  data-model.md   — DB schema (PostGIS) — table + junction list, ER diagram at the top
  architecture.md — repo layout, backend layers, deployment
  api.md          — REST contracts
  backups.md      — backup/restore source of truth: weekly cron, failure-discovery, restore drill, manual snapshot + rollback
```

Plan / audit / history docs live in git, not in `docs/`. Implemented work is described in `CHANGELOG.md`; the rationale that drove each change is in the PR description and the commit. There is no `archive/` folder.

**Why this much documentation for a solo project.** The doc framework, the doc-sync CI rule, and the structured CLAUDE.md exist for a specific reason: this codebase is primarily worked on with AI coding assistants. An assistant arrives at every session with zero context and is only as useful as the surface it can read in a few hundred lines. The docs are the persistent memory the assistant doesn't have. *next.md* tells it what's on the table; *roadmap.md* tells it what's not; *data-model.md* and *api.md* let it answer questions about the schema and endpoints without grepping. CLAUDE.md is the first thing it reads. The doc-sync CI is what stops the docs from rotting two PRs after they were written. If you're reading this and it looks like enterprise process for an over-engineered solo project — it's actually the minimum viable agent-onboarding surface, and the per-PR cost is small once it's a habit.

## Before merging — doc sync rule

**When you ship or scope work, update the docs in the same PR.** The framework only stays useful if the moves below happen as part of the change, not as an afterthought:

- **Item shipped?** Delete it from `docs/next.md`. Add a one-line entry to `CHANGELOG.md` under `## Unreleased` with the PR number. Don't leave `[x]` markers — items are open or absent. The CHANGELOG is the record.
- **Item descoped or postponed indefinitely?** Move it to the *Unscheduled candidates* section of `next.md`.
- **Candidate getting committed to scope?** Move it from *Unscheduled candidates* into a milestone with concrete scope.
- **Candidate rejected?** Delete it from *Unscheduled candidates*. No headstone.

If the change touches a published surface, sync the matching tech doc:

- New / changed endpoint, request/response shape, status code, auth requirement → `docs/api.md`
- New / changed column, table, index → `docs/data-model.md` (the table block **and** the ER diagram at the top)
- Deployment, repo layout, or platform-quirk change → `docs/architecture.md`
- Tech choice swap (not routine version bumps) → `docs/stack.md`
- Auth model, deployment URLs, env vars, or primary dev workflow → `CLAUDE.md` and `README.md`
- Palette recipe or shared style constant in [`styles.ts`](frontend/src/components/ui/styles.ts) → `docs/design.md` (*Orange palette recipe*)

`vision.md`, `roadmap.md`, and `design.md` only churn on strategic-direction or design-rule changes — not on every feature.

**Self-check before opening the merge button:** read the touched docs cold and ask "does this match reality after my change?" If a new contributor would be misled, the PR isn't ready.

The pairings above (routers ↔ `api.md`, models/migrations ↔ `data-model.md`, deploy/infra ↔ `architecture.md`, production code ↔ `CHANGELOG.md`) are also enforced mechanically in CI — see [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml). The workflow fails a PR when one side of the pair moves without the other. Tune the rules there when a new doc-drift class shows up; don't add speculative rules that just train people to ignore the check.

## Repo layout

`backend/` (FastAPI, uv): `app/` is routers → services → models + Pydantic schemas + middleware; `alembic/` migrations; `scripts/` local-dev helpers (not prod ops). `frontend/` (Next.js 14, npm): `src/app/` App Router pages (public landing at `/`, map at `/map`, auth route group; in-app pages share `PageShell`), `src/components/` (Sidebar, `map/`, `editor/`, `ui/`). Flat `docs/`; `docker/` custom PG image; `.github/workflows/` CI + deploy; `Makefile` local-dev entry points. `video/` is the "promo as code" pipeline — Playwright records a live Chrome run against the local dev stack, Remotion wraps it with intro/captions/outro, one `make promo` re-renders the closed-beta promo MP4 from source (see [`video/README.md`](video/README.md)).

Full annotated tree: [`docs/architecture.md`](docs/architecture.md) → *Repository layout*.

## Local development

Standard path is the `Makefile`:

```bash
make init        # install + env + db-up + migrate (one-shot bootstrap)
make seed        # mock-admin + 50 demo geolocations + admin follows every demo analyst
make dev         # FastAPI (:8000) + Next.js (:3000) in parallel
make test        # backend pytest
```

`make seed` creates `admin@vidit.app` / `admin` and gives the local admin a populated `/timeline`. `EMAIL_PROVIDER=console` (the default in `backend/.env.example`) echoes registration confirmation links to backend stdout — copy-paste into the browser to finish the flow. Full walk-through and troubleshooting: [`README.md`](README.md) → *Getting started (local dev)*.

### Running multiple frontends against one backend

The local CORS allowlist accepts every `localhost:<port>` (http or https) by default — see [`backend/app/config.py`](backend/app/config.py) (`cors_origin_regex`). A single backend on `:8000` serves any number of concurrent frontends (main checkout, worktrees, alternate ports) without restart. To run a frontend on a non-default port, point it at the local backend and pick a free port:

```
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 npx next dev -p 3030
```

The override is *only* the localhost regex — explicit `CORS_ORIGINS` (production hosts) still apply. Auth cookies are domain-scoped, so this is safe in prod too: a page at `localhost:N` in a real user's browser can't include `.vidit.app` cookies in a request to `api.vidit.app` even if CORS lets the request through.

In prod, set `CORS_ORIGIN_REGEX=` (empty) in Railway env vars to drop the localhost allowance — cookie scoping already prevents real attacks, but it keeps the public CORS surface tight.

## Conventions

- **Code language: English** (variables, functions, comments, commit messages)
- **Documentation language: English** (this repo, `docs/`, README)
- Backend layering: routers → services → models (no business logic in routers)
- Pydantic schemas: `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`
- API endpoints follow the contracts in [`docs/api.md`](docs/api.md)
- UI: reach for `PageShell` + the constants in [`styles.ts`](frontend/src/components/ui/styles.ts) before rolling your own layout or palette classes — see *UI conventions* above
