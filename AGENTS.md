# Vidit — project context for AI tools

Setup, PR flow, and conventions live in [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Read both before working.

## Where things live

| Content | Home | Not allowed in |
|---|---|---|
| Strategy / vision / version milestones | `planning/roadmap.md` | `docs/`, source code |
| Work tracker / priorities | `planning/next.md` | `docs/`, source code |
| Reference (API, schema, ops, design) | `docs/*.md` | `planning/` |
| Release history | `CHANGELOG.md` | `docs/`, `planning/` |
| Contribution flow + doc-sync rule | `CONTRIBUTING.md` | scattered |
| Local-dev setup | `README.md` | `docs/`, `planning/` |
| AI / agent rules (this file) | `AGENTS.md` | scattered |

CI enforces a floor — every PR to `main` must touch *both* `docs/` and `planning/`. See the `docs-pairing` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Granular pairings (routers ↔ `api.md`, version milestones only in `planning/`, etc.) are conventions the writing rules below + human review own; the check stays deliberately blunt so it ages well.

## Doc writing rules

1. **One fact, one home.** If it lives elsewhere, link; don't restate.
2. **No tracker content in reference docs or code.** No `(current)`, `Status:`, version milestones (`v0.4`, `v0.5`…), or their names (e.g. *Open beta*) in `docs/*.md` or source files. Roadmap tracking lives in `planning/`, `CHANGELOG.md`, and contributor-facing meta (README, AGENTS, CONTRIBUTING, issue templates). The reader-facing roadmap on the public landing is the one sanctioned projection.
3. **No hedge prose in reference docs.** "We should consider…", "may want to…", "it's important to…" — make it a decision or a task in next.md.
4. **No "for context" / "for clarity" intros.** State the thing.
5. **Adjectives → consequences or delete.** "Critical" → "fails the deploy if missing". "Important" → delete. "Complex" → describe or drop.
6. **If a sentence can be deleted with no information loss, delete it.**

## Conventions

- Code language: English — variables, functions, comments, commit messages
- Backend layering: routers → services → models (no business logic in routers)
- Pydantic schemas: `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`
- UI: reach for `PageShell` + the constants in [`styles.ts`](frontend/src/components/ui/styles.ts) before rolling your own — full vocabulary in [`docs/design.md`](docs/design.md)
- Single source of truth: before adding a helper, constant, or type, grep for an existing one — a duplicated source-of-truth is what review rejects first. Validation has one backend home: MIME allowlist → [`services/storage.py`](backend/app/services/storage.py), coordinate bounds → `services/geolocations.validate_coordinates`, password length → `schemas/auth.PASSWORD_MIN_LENGTH`. Frontend enum types are **generated** from the OpenAPI spec ([`lib/api-types.ts`](frontend/src/lib/api-types.ts)) — never hand-write them; the remaining FE↔BE mirrors ([`lib/mediaTypes.ts`](frontend/src/lib/mediaTypes.ts), [`lib/coordinates.ts`](frontend/src/lib/coordinates.ts)) are hand-kept, so change the pair together. CI enforces this — `jscpd` (no new copy-paste), `knip` (no dead frontend code), and the `api-types` drift gate (`make hygiene` runs the first two locally).
