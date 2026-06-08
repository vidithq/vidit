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
4. **Update the docs in the same PR.** Touching at least one file under `docs/` and one under `planning/` is mechanically enforced by [`.github/workflows/docs-pairing.yml`](.github/workflows/docs-pairing.yml) — see *Doc-sync rule* below for the conventions the check is a floor for.
5. **PR title is a Conventional Commit.** See *Commit conventions* below — the title is also checked in CI by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml).
6. **CI must be green.** Backend, frontend, `docs-pairing`, PR-title, and DCO workflows all need to pass.
7. **Sign off every commit.** See *Contributor sign-off* below.
8. **Read touched docs cold before requesting review** — if anything misleads a new contributor, the PR isn't ready.

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

## Contributor sign-off

Every commit on a PR must carry a `Signed-off-by:` trailer. This is the [Developer Certificate of Origin 1.1](https://developercertificate.org) — by signing off, you certify that you have the right to submit the code under [AGPL-3.0](LICENSE). It is **not** a CLA: there is no relicensing clause, inbound = outbound = AGPL-3.0 (the PostgreSQL / Mastodon shape).

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

The DCO check ([`.github/workflows/dco.yml`](.github/workflows/dco.yml)) walks every commit on the PR and fails on the first one without the trailer.

## Doc-sync rule

- **Item shipped?** Delete it from [`next.md`](planning/next.md). Add a one-line entry to [`CHANGELOG.md`](CHANGELOG.md) under `## Unreleased` with the PR number.
- **Item descoped?** Move it to *Unscheduled candidates* in `next.md`. Rejected → delete.

Touched a published surface → sync the matching doc:

- Endpoints → [`api.md`](docs/api.md)
- Tables / columns / migrations → [`data-model.md`](docs/data-model.md) (table block **and** ER diagram)
- Deploy / repo / infra / tech swap → [`engineering.md`](docs/engineering.md)
- Auth model, deploy URLs, env vars, dev workflow → [`../AGENTS.md`](AGENTS.md) and [`../README.md`](README.md)
- Palette or shared style constant → [`design.md`](docs/design.md)

CI enforces the floor: every PR must touch *something* under `docs/` AND something under `planning/` — see [`.github/workflows/docs-pairing.yml`](.github/workflows/docs-pairing.yml). The specific pairings above are conventions human review still owns; the check is friction-first to keep the tracker and reference docs honest, not a granular contract.

## Security issues

**Do not open a public issue for a security vulnerability.** See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Reports go to `conduct@vidit.app`.
