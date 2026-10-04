# Contributing to Vidit

## Open posture

Vidit is open source under [AGPL-3.0](LICENSE), with no proprietary tier. See [`roadmap.md`](planning/roadmap.md) → *Openness & transparency*.

Contributions that exist only to enable a competing hosted SaaS on top of this codebase are out of scope for the upstream. Fork freely (AGPL allows it), but expect review to push back.

## Before you start

- **Read [`roadmap.md`](planning/roadmap.md)** for the *why*, the milestone ladder, and what's deferred to *future considerations*.
- **Browse the [GitHub Project](https://github.com/orgs/vidithq/projects/1)** to see open work. Each item is an issue in `vidithq/vidit` with a type (Feature, Debt, Task, Bug) and the project fields Status, Priority (P0 to P3), Version (v0.6 to v1.0, or Unscheduled), and Area. Shipped items move to [`CHANGELOG.md`](CHANGELOG.md).
- **Read [`AGENTS.md`](AGENTS.md)** for project conventions.

For substantial work, file an issue first.

## Set up a local dev environment

See [`README.md`](README.md#getting-started-local-dev) → *Getting started (local dev)*.

## Pull request flow

1. **Fork + branch.** Name the branch after the work, not the issue number: `feat/capture-source-filter`, `fix/tweet-import-cache-leak`, `docs/api-request-claim`.
2. **One coherent change per PR.** A bug fix shouldn't drag in surrounding cleanup; "while I was there" refactors land in their own PR.
3. **Write the tests that lock in the change, and reproduce CI locally before pushing.** Backend, from `backend/` (CI's lint job stops at the first failing step, so a red `ruff` masks a `mypy` or `vulture` failure behind it: run all four, then the tests):

   ```bash
   uv run ruff check .
   uv run ruff format --check .   # catches line-wrap issues `ruff check` doesn't
   uv run mypy app                # checks app/ only; scripts/ and tests/ aren't covered
   uv run vulture                 # dead code: removing a helper's last caller orphans it here
   uv run pytest -n auto --dist loadfile  # parallel: one clone database per worker, built from a migrated template; needs the docker-compose Postgres up
   ```

   Plain `uv run pytest` still works (serial, against the dev database as-is; needs `uv run alembic upgrade head`).

   Frontend, from `frontend/`: `npm test` (Vitest, colocated `*.test.ts(x)`), plus `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e` (Playwright; run `npx playwright install chromium` once first). `make hygiene` runs the cross-cutting gates (`make help` lists them). What the Playwright suite measures and why jsdom cannot: [`docs/engineering.md`](docs/engineering.md#narrow-viewport-smoke-tests).
4. **Update the docs in the same PR.** See [*Doc-sync rule*](#doc-sync-rule) below.
5. **PR title is a Conventional Commit.** See *Commit conventions* below; the title is also checked in CI by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml).
6. **CI must be green.** Every job of the `ci` workflow, the PR-title workflow, CodeQL, and the `DCO` status check (Probot app) must pass. [`docs/engineering.md`](docs/engineering.md#github-actions) lists the jobs.
7. **Sign off every commit.** See *Contributor sign-off* below.
8. **Read touched docs cold before requesting review.** If anything misleads a new contributor, the PR isn't ready.

## Commit conventions

The repo uses [Conventional Commits](https://www.conventionalcommits.org/). Types accepted by `pr-title.yml`:

```
feat   fix   docs   style   refactor   perf   test   build   ci   chore   revert
```

Scope is optional. Subject must start with a lowercase letter. Examples:

```
feat(tags): required capture-source + conflict categories on submit
fix(security): harden archive path validation against traversal
docs: reorganize, consolidate, and code-verify documentation
chore(repo): pre-invite dead-code cleanup + factorization pass
```

PR title is the commit message (squash-merge).

## Contributor sign-off

Every commit on a PR must carry a `Signed-off-by:` trailer. This is the [Developer Certificate of Origin 1.1](https://developercertificate.org): by signing off, you certify that you have the right to submit the code under [AGPL-3.0](LICENSE). It is **not** a CLA: there is no relicensing clause, inbound = outbound = AGPL-3.0.

Add the trailer with `git commit -s`:

```bash
git commit -s -m "feat(map): cluster by capture source"
# → final line of the message is:
#   Signed-off-by: Your Name <you@example.com>
```

If you forgot, amend the latest commit or sign-off the whole branch:

```bash
git commit --amend --signoff
git rebase --signoff main
```

The check is posted by the [DCO App](https://github.com/apps/dco) (Probot, installed on the org) as a status named `DCO`. It walks every commit on the PR and fails on the first one without the trailer.

An amend + force-push to fix a missing sign-off often re-triggers only the DCO check: the Actions workflows (`ci`, PR title) may not re-run on the new head, leaving the PR blocked on missing required checks even though it shows as mergeable. Close and reopen the PR (`gh pr close <n> && gh pr reopen <n>`) to re-fire them against the current head.

## Doc-sync rule

- **New work?** Open an issue in `vidithq/vidit`, set its type (Feature, Debt, Task, Bug), and add it to the [GitHub Project](https://github.com/orgs/vidithq/projects/1) with Priority, Version, and Area set.
- **Item shipped?** Put `Closes #N` in the PR description so the merge closes the issue. Add an entry to [`CHANGELOG.md`](CHANGELOG.md) under `## Unreleased`: one line, ending with the PR link, and no file lists (the PR carries them).
- **Item descoped?** Set its Version to Unscheduled. Rejected → close the issue as not planned.

Touched a published surface → sync the matching doc. The checklist in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) maps each surface to its doc.

CI enforces a floor: every PR must touch something under `docs/` (the `docs-pairing` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)). The checklist pairings are conventions that human review owns; the check does not verify them. A PR with no docs impact (a roadmap change, a CI or meta tweak) can carry the **`no-docs-needed`** label to pass the check; justify it in the PR description. Dependabot PRs are exempt.

## Security issues

**Do not open a public issue for a security vulnerability.** See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to `conduct@vidit.app`.
