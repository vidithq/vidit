# Contributing to Vidit

Thanks for reading this. Vidit is a small, opinionated project — every contribution that fits the scope below moves it forward.

## Open posture

Vidit is **100% open source under [AGPL-3.0](LICENSE)**. There is no proprietary tier and there is no internal version. Everything that runs on `vidit.app` is in this repository, and anyone is welcome to self-host the full feature set.

Future monetization on the maintainer's hosted instance (`vidit.app`) is **API rate limits + a small set of paid-only endpoints** (e.g. saved-search alert webhooks, larger exports). The unit of sale is throughput against the hosted infrastructure, not feature access. **Contributions that further the open codebase are welcome.** Contributions that build out a competing hosted commercial offering on top of this codebase are out of scope for the upstream — fork freely (AGPL is happy with that), but expect upstream review to push back on changes that exist only to enable a competing SaaS.

If you're unsure whether an idea fits, open a discussion or a tracking issue before writing code.

## Before you start

- **Read [`docs/vision.md`](docs/vision.md)** so the *why* lines up.
- **Read [`docs/next.md`](docs/next.md)** so you can see what's on the table this milestone. Items get deleted when they ship; what's not there is either already done (in [`CHANGELOG.md`](CHANGELOG.md)) or out of scope (the [*Unscheduled candidates*](docs/next.md#unscheduled-candidates) section explicitly says "no commitment").
- **Read [`docs/roadmap.md`](docs/roadmap.md)** for what's explicitly *not* in scope — confidence levels, per-submission voting, comments, reputation math, native mobile, bulk import. The list is short and load-bearing.
- **Read [`CLAUDE.md`](CLAUDE.md)** — it's the project's compact context doc (stack, conventions, UI vocabulary, the doc-sync rule). It's written for AI assistants, but humans get the same value.

For substantial work, file an issue first. Lining up scope before code avoids the worst kind of rejection.

## Set up a local dev environment

Everything is in [`README.md`](README.md#getting-started-local-dev) → *Getting started (local dev)*. Short version:

```bash
make init   # install + env + db-up + migrate
make seed   # mock admin + demo geolocations
make dev    # FastAPI :8000 + Next.js :3000
make test   # backend pytest
```

`EMAIL_PROVIDER=console` (the default in `backend/.env.example`) prints registration confirmation links to backend stdout — copy-paste into the browser to finish the auth flow locally.

## Pull request flow

1. **Fork + branch.** Name the branch after the work, not the issue number — `feat/capture-source-filter`, `fix/tweet-import-cache-leak`, `docs/api-bounty-claim`.
2. **One coherent change per PR.** A bug fix shouldn't drag in surrounding cleanup; "while I was there" refactors land in their own PR. Reviewers can hold the whole diff in their head when the scope is one thing.
3. **Write the tests that lock in the change.** Backend: `pytest` next to whatever you touched. Frontend: prefer changes that can be verified with `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
4. **Update the docs in the same PR.** This is mechanically enforced by [`.github/workflows/doc-sync.yml`](.github/workflows/doc-sync.yml) — see *Doc-sync rule* below. Don't try to land a router change without updating `docs/api.md`; the workflow will block the merge.
5. **PR title is a Conventional Commit.** See *Commit conventions* below — the title is also checked in CI by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml).
6. **CI must be green.** Backend, frontend, doc-sync, and PR-title workflows all need to pass.
7. **Walk the touched docs cold before requesting review.** Read them as if you're a new contributor. If anything would mislead you, the PR isn't ready.

## Commit conventions

The repo uses [Conventional Commits](https://www.conventionalcommits.org/). The set of types accepted by `pr-title.yml` is:

```
feat   fix   docs   style   refactor   perf   test   build   ci   chore   revert
```

Scope is optional. Subject must start with a lowercase letter. Examples drawn from `git log`:

```
feat(tags): required capture-source + conflict categories on submit
fix(security): code-review follow-up — 11 of 15 findings
docs: reorganize, consolidate, and code-verify documentation
chore(repo): pre-invite dead-code cleanup + factorization pass
```

The PR title is what lands on `main` (squash-merge), so the title *is* the commit message.

## Doc-sync rule

The full rule lives in [`CLAUDE.md`](CLAUDE.md) → *Before merging — doc sync rule*. The short version: when you change a published surface, you update its paired doc in the same PR. Pairings:

| You touched | You also update |
|---|---|
| `backend/app/routers/**` | `docs/api.md` |
| `backend/app/models/**`, `backend/alembic/versions/**` | `docs/data-model.md` (table block + ER diagram) |
| `.github/workflows/**`, `backend/Dockerfile`, `backend/railway.json`, `docker-compose.yml` | `docs/architecture.md` |
| `backend/app/**`, `frontend/src/**`, `backend/alembic/versions/**` | `CHANGELOG.md` (one-line entry under `## Unreleased`) |

Tests are excluded from the CHANGELOG rule — green refactors don't need a user-facing entry.

If a rule is wrong for your case (you really did just rename a private symbol with no published-surface impact), say so in the PR description; the rules are tuned to past drift, not theory.

## Security issues

**Do not open a public issue for a security vulnerability.** See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to `conduct@vidit.app`.
