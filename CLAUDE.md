# Vidit — project context for AI tools

## What it is

A web platform for OSINT/GEOINT analysts to archive, reference, and visualize geolocations of armed-conflict events.

Strategy and phases: [`docs/roadmap.md`](docs/roadmap.md). Active work: [`docs/next.md`](docs/next.md). What shipped: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Docs

```
docs/
  roadmap.md         — vision, 4 phases, openness commitment
  next.md            — milestones + unscheduled candidates (work tracker)
  design.md          — design system + orange-palette recipe + UI vocabulary
  engineering.md     — tech stack, repo layout, deployment, particularities
  data-model.md      — DB schema + ER diagram
  api.md             — REST contracts
  backups.md         — weekly cron + restore drill + manual snapshot/rollback
  CHANGELOG.md       — what shipped per release (append-only)
  CONTRIBUTING.md    — PR flow, doc-sync rule, commit conventions
  CODE_OF_CONDUCT.md — Contributor Covenant 2.1
  SECURITY.md        — vulnerability reporting
```

## Doc sync rule (per PR)

When you ship, update the docs:

- **Item shipped?** Delete it from `docs/next.md`. Add a one-line entry to `docs/CHANGELOG.md` under `## Unreleased` with the PR number.
- **Item descoped?** Move it to *Unscheduled candidates* in `next.md`. Rejected? Delete it — no headstone.

Touched a published surface → sync the matching doc:

- Endpoints → `docs/api.md`
- Tables / columns / migrations → `docs/data-model.md` (table block **and** ER diagram)
- Deploy / repo / infra / tech swap → `docs/engineering.md`
- Auth model, deploy URLs, env vars, dev workflow → `CLAUDE.md` and `README.md`
- Palette or shared style constant → `docs/design.md`

CI enforces routers ↔ `api.md`, models/migrations ↔ `data-model.md`, deploy/infra ↔ `engineering.md`, production code ↔ `docs/CHANGELOG.md` — see [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml).

## Doc writing rules

1. **One fact, one home.** If it lives elsewhere, link; don't restate.
2. **No tracker content in reference docs.** No `(current)`, `Status:`, or milestone names (M1, M2, M3) outside `next.md` and `CHANGELOG.md`.
3. **No hedge prose in reference docs.** "We should consider…", "may want to…", "it's important to…" — make it a decision or a task in next.md.
4. **No "for context" / "for clarity" intros.** State the thing.
5. **Adjectives → consequences or delete.** "Critical" → "fails the deploy if missing". "Important" → delete. "Complex" → describe or drop.
6. **If a sentence can be deleted with no information loss, delete it.**

## Conventions

- Code language: English — variables, functions, comments, commit messages
- Backend layering: routers → services → models (no business logic in routers)
- Pydantic schemas: `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`
- UI: reach for `PageShell` + the constants in [`styles.ts`](frontend/src/components/ui/styles.ts) before rolling your own — full vocabulary in [`docs/design.md`](docs/design.md)

## Local dev

```bash
make init        # install + env + db-up + migrate (one-shot bootstrap)
make seed        # mock-admin + 50 demo geolocations
make dev         # FastAPI :8000 + Next.js :3000 in parallel
make test        # backend pytest
```

`EMAIL_PROVIDER=console` (default in `backend/.env.example`) echoes registration links to backend stdout. Full setup + multi-frontend / CORS notes: [`README.md`](README.md) → *Getting started*.
