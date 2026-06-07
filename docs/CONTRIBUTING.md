# Contributing to Vidit

## Open posture

Vidit is **100% open source under [AGPL-3.0](../LICENSE)** — no proprietary tier, no internal version. The rationale (open codebase, monetization via API rate limits on the maintainer's hosted instance) lives in [`roadmap.md`](roadmap.md) → *Openness & transparency*.

Contributions that exist only to enable a competing hosted SaaS on top of this codebase are out of scope for the upstream — fork freely (AGPL allows it), but expect review to push back.

## Before you start

- **Read [`roadmap.md`](roadmap.md)** for the *why*, the four phases, and what's explicitly *not* in scope (confidence levels, per-submission voting, comments, reputation math, native mobile, bulk import).
- **Read [`next.md`](next.md)** to see what's on the table this milestone. Open work only; shipped items move to [`CHANGELOG.md`](CHANGELOG.md).
- **Read [`CLAUDE.md`](../CLAUDE.md)** for project conventions and the doc-sync rule.

For substantial work, file an issue first.

## Set up a local dev environment

See [`README.md`](../README.md#getting-started-local-dev) → *Getting started (local dev)*.

## Pull request flow

1. **Fork + branch.** Name the branch after the work, not the issue number — `feat/capture-source-filter`, `fix/tweet-import-cache-leak`, `docs/api-bounty-claim`.
2. **One coherent change per PR.** A bug fix shouldn't drag in surrounding cleanup; "while I was there" refactors land in their own PR.
3. **Write the tests that lock in the change.** Backend: `pytest` next to whatever you touched. Frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build`.
4. **Update the docs in the same PR.** This is mechanically enforced by [`.github/workflows/doc-sync.yml`](../.github/workflows/doc-sync.yml) — see *Doc-sync rule* below.
5. **PR title is a Conventional Commit.** See *Commit conventions* below — the title is also checked in CI by [`.github/workflows/pr-title.yml`](../.github/workflows/pr-title.yml).
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

See [`CLAUDE.md`](../CLAUDE.md) → *Doc sync rule (per PR)*. Enforced by [`.github/workflows/doc-sync.yml`](../.github/workflows/doc-sync.yml).

## Security issues

**Do not open a public issue for a security vulnerability.** See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to `conduct@vidit.app`.
