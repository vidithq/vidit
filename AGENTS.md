# Vidit: project context for AI tools

Setup, PR flow, and conventions live in [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Read both before working.

## Where things live

| Content | Home | Not allowed in |
|---|---|---|
| Strategy / vision / version milestones | `planning/roadmap.md` | `docs/`, source code |
| Work tracker / priorities | [GitHub Project](https://github.com/orgs/vidithq/projects/1) (issues in `vidithq/vidit`) | `docs/`, `planning/`, source code |
| Reference (API, schema, ops, design) | `docs/*.md` | `planning/` |
| Release history | `CHANGELOG.md` | `docs/`, `planning/` |
| Contribution flow + doc-sync rule | `CONTRIBUTING.md` | scattered |
| Local-dev setup | `README.md` | `docs/`, `planning/` |
| AI / agent rules (this file) | `AGENTS.md` | scattered |

CI enforces a floor: every PR to `main` must touch `docs/`. See the `docs-pairing` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Granular pairings (routers ↔ `api.md`, version milestones only in `planning/`, etc.) are conventions the writing rules below + human review own; the check stays deliberately blunt so it ages well.

## Doc writing rules

1. **One fact, one home.** If it lives elsewhere, link; don't restate.
2. **No tracker content in reference docs or code.** No `(current)`, `Status:`, version milestones (`v0.4`, `v0.5`…), or their names (e.g. *Open beta*) in `docs/*.md` or source files. Roadmap tracking lives in `planning/roadmap.md`, the GitHub Project, `CHANGELOG.md`, and contributor-facing meta (README, AGENTS, CONTRIBUTING, issue templates). The reader-facing roadmap on the public landing is the one sanctioned projection.
3. **No hedge prose in reference docs.** "We should consider…", "may want to…", "it's important to…": make it a decision or an issue in the GitHub Project.
4. **No "for context" / "for clarity" intros.** State the thing.
5. **Adjectives → consequences or delete.** "Critical" → "fails the deploy if missing". "Important" → delete. "Complex" → describe or drop.
6. **If a sentence can be deleted with no information loss, delete it.**
7. **Google developer documentation style in `docs/*.md`.** Second person, present tense, active voice, imperative mood for instructions, sentence-case headings, one idea per sentence. No aphorisms, idioms, metaphors, marketing adjectives, rhetorical questions, or exclamation marks.
8. **Diagram first.** A human-facing doc opens with a Mermaid diagram of the mechanism, function or module names in bold, one visual class per level of sharing or criticality, and a legend; the prose then explains one region of the diagram at a time, and a section that needs more detail gets another diagram in the same style rather than paragraphs. Reference tables stay tables (the grammar table, warning and refusal codes, disposition matrices), and every diagram renders locally before it is committed (`npx -y @mermaid-js/mermaid-cli -i x.mmd -o x.png -b white --size 1500`); [`ingestion.md`](docs/ingestion.md) is the model.

## Conventions

- Code language: English (variables, functions, comments, commit messages)
- Backend layering: routers → services → models (no business logic in routers)
- Pydantic schemas: `XxxCreate`, `XxxRead`, `XxxUpdate`, `XxxList`
- **Front-end: compose from shared primitives, never hand-roll a one-off.** Every UI element reuses or thinly wraps an existing primitive: `PageShell` / `PageFrame` for page scaffolding, the `FORM_*` constants in [`form-styles.ts`](frontend/src/components/ui/form-styles.ts) for inputs, labels and banners, the colour constants in [`styles.ts`](frontend/src/components/ui/styles.ts) for accents, and the [`components/ui/`](frontend/src/components/ui) atoms (Pill, FieldHelp, Avatar, FileManager, ...). A bespoke input, button or card defined inline in a page or feature component is a review-blocker, because that is how one widget drifts into incompatible versions. **Palette-first:** consult the live catalogue at [`/palette`](frontend/src/app/palette/page.tsx) (dev route) and use a primitive or constant that fits. Before writing styled markup that is itself a UI element (control, card, badge, pill, panel, input, section, tile) and does not reduce to existing primitives, **stop and ask the maintainer** whether you intend a new reusable primitive or a deliberate one-off. Not gated: composing primitives into a page or layout (`PageShell` / `Card` plus flex or grid wrappers, spacing) and the known-bespoke surfaces (`map/` canvas, the Tiptap proof editor, `FileManager` internals, page scaffolding, image and asset routes). Swapping to an existing constant or adding a focus affordance to an existing wrapper needs no confirmation. A new primitive also gets a `/palette` entry. Full vocabulary: [`docs/design.md`](docs/design.md).
- Single source of truth: before adding a helper, constant, or type, grep for an existing one, since a duplicated source of truth is what review rejects first. Validation has one backend home: MIME allowlist → [`services/storage.py`](backend/app/services/storage.py), coordinate bounds → `services/events.validate_coordinates`, password length → `schemas/auth.NewPassword`. Frontend enum types are **generated** from the OpenAPI spec ([`lib/api-types.ts`](frontend/src/lib/api-types.ts)), never hand-written. Every other frontend mirror of a backend rule is hand-kept and listed in [`docs/engineering.md` → Hand-kept mirrors](docs/engineering.md#hand-kept-mirrors): change both sides in the same PR, and add a new mirror to that table. CI enforces the rest: `jscpd` (caps duplication at 1%), `knip` (no dead frontend code), `vulture` (no dead backend code), the `api-types` drift gate, and a **palette-coverage** gate (every `components/ui/` primitive and style constant must be named in `/palette`). `make hygiene` runs the local subset.
- Code comments: default to none. A comment states only what the code cannot: a hidden constraint or invariant, a bug it prevents, a security or performance rationale, why a `# type: ignore` / `@ts-expect-error` exists, a non-obvious decision, or surprising external behaviour. Delete comments that restate the adjacent line, docstrings that echo the signature, and `Usage:` blocks for trivial symbols. Keep the first-line summary of a FastAPI route-handler docstring: it surfaces as the OpenAPI description. Keep one short pointer on each side of a hand-kept mirror ([`engineering.md#hand-kept-mirrors`](docs/engineering.md#hand-kept-mirrors)), for example `Mirrors backend storage.derivative_key; change both.`, and keep a comment to the fewest lines that hold the fact.
