# Contributing to Vidit

## Open posture

Vidit is **100% open source under [AGPL-3.0](LICENSE)** — no proprietary tier, no internal version. The rationale (open codebase, monetization via API rate limits on the maintainer's hosted instance) lives in [`roadmap.md`](planning/roadmap.md) → *Openness & transparency*.

Contributions that exist only to enable a competing hosted SaaS on top of this codebase are out of scope for the upstream — fork freely (AGPL allows it), but expect review to push back.

## Before you start

- **Read [`roadmap.md`](planning/roadmap.md)** for the *why*, the forward direction (M1 → M2 → M3), and what's deferred to *future considerations*.
- **Read [`next.md`](planning/next.md)** to see what's on the table this milestone. Open work only; shipped items move to [`CHANGELOG.md`](CHANGELOG.md).
- **Read [`AGENTS.md`](AGENTS.md)** for project conventions.

For substantial work, file an issue first.

## Set up a local dev environment

See [`README.md`](README.md#getting-started-local-dev) → *Getting started (local dev)*.

## Pull request flow

1. **Fork + branch.** Name the branch after the work, not the issue number — `feat/capture-source-filter`, `fix/tweet-import-cache-leak`, `docs/api-bounty-claim`.
2. **One coherent change per PR.** A bug fix shouldn't drag in surrounding cleanup; "while I was there" refactors land in their own PR.
3. **Write the tests that lock in the change.** Backend: `pytest` next to whatever you touched. Frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build`.
4. **Update the docs in the same PR.** This is mechanically enforced by [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml) — see *Doc-sync rule* below.
5. **PR title is a Conventional Commit.** See *Commit conventions* below — the title is also checked in CI by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml).
6. **CI must be green.** Backend, frontend, doc-sync, and PR-title workflows all need to pass.
7. **Read touched docs cold before requesting review** — if anything misleads a new contributor, the PR isn't ready.

## Commit conventions

The repo uses [Conventional Commits](https://www.conventionalcommits.org/). Types accepted by `pr-title.yml`:

```
feat   fix   docs   style   refactor   perf   test   build   ci   chore   revert
```

Scope is optional. Subject must start with a lowercase letter. Examples:

```
feat(tags): required capture-source + conflict categories on submit
fix(security): code-review follow-up — 11 of 15 findings
docs: reorganize, consolidate, and code-verify documentation
chore(repo): pre-invite dead-code cleanup + factorization pass
```

PR title is the commit message (squash-merge).

## Doc-sync rule

- **Item shipped?** Delete it from [`next.md`](planning/next.md). Add a one-line entry to [`CHANGELOG.md`](CHANGELOG.md) under `## Unreleased` with the PR number.
- **Item descoped?** Move it to *Unscheduled candidates* in `next.md`. Rejected → delete.

Touched a published surface → sync the matching doc:

- Endpoints → [`api.md`](docs/api.md)
- Tables / columns / migrations → [`data-model.md`](docs/data-model.md) (table block **and** ER diagram)
- Deploy / repo / infra / tech swap → [`engineering.md`](docs/engineering.md)
- Auth model, deploy URLs, env vars, dev workflow → [`../AGENTS.md`](AGENTS.md) and [`../README.md`](README.md)
- Palette or shared style constant → [`design.md`](docs/design.md)

CI enforces routers ↔ `api.md`, models/migrations ↔ `data-model.md`, deploy/infra ↔ `engineering.md`, production code ↔ `CHANGELOG.md` — see [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml).

## Security issues

**Do not open a public issue for a security vulnerability.** See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to `conduct@vidit.app`.
