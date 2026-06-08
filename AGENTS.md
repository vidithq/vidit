# Vidit — project context for AI tools

Setup, PR flow, and conventions live in [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Read both before working.

## Where things live

| Content | Home | Not allowed in |
|---|---|---|
| Strategy / vision / macros (M1, M2, M3) | `planning/roadmap.md` | `docs/`, source code |
| Work tracker / priorities | `planning/next.md` | `docs/`, source code |
| Reference (API, schema, ops, design) | `docs/*.md` | `planning/` |
| Release history | `CHANGELOG.md` | `docs/`, `planning/` |
| Contribution flow + doc-sync rule | `CONTRIBUTING.md` | scattered |
| Local-dev setup | `README.md` | `docs/`, `planning/` |
| AI / agent rules (this file) | `AGENTS.md` | scattered |

CI enforces it: milestone IDs and `next.md` / `roadmap.md` references only appear in `planning/`, root meta files, issue / PR templates, and `docs/engineering.md` (repo tree). See [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml) → *Rule 5*.

## Doc writing rules

1. **One fact, one home.** If it lives elsewhere, link; don't restate.
2. **No tracker content in reference docs or code.** No `(current)`, `Status:`, milestone IDs (M1, M2, M3), or macro names (e.g. *Open beta*) in `docs/*.md` or source files. Milestone tracking lives in `planning/`, `CHANGELOG.md`, and contributor-facing meta (README, AGENTS, CONTRIBUTING, issue templates).
3. **No hedge prose in reference docs.** "We should consider…", "may want to…", "it's important to…" — make it a decision or a task in next.md.
4. **No "for context" / "for clarity" intros.** State the thing.
5. **Adjectives → consequences or delete.** "Critical" → "fails the deploy if missing". "Important" → delete. "Complex" → describe or drop.
6. **If a sentence can be deleted with no information loss, delete it.**

## Conventions

- Code language: English — variables, functions, comments, commit messages
- Backend layering: routers → services → models (no business logic in routers)
- Pydantic schemas: `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`
- UI: reach for `PageShell` + the constants in [`styles.ts`](frontend/src/components/ui/styles.ts) before rolling your own — full vocabulary in [`docs/design.md`](docs/design.md)
