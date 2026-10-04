<!--
Title: Conventional Commit format, `type(scope): subject`, subject starts lowercase.
Enforced by .github/workflows/pr-title.yml. Examples in CONTRIBUTING.md.
-->

## Summary

What this change does, in one to three sentences. Fill in the issue this PR closes, or delete the line if there is none.

Closes #

## Why

Why this is the right change: the user problem, the constraint, the trade-off. Skip if the summary already covers it.

## Doc-sync checklist

CI fails the PR unless it touches `docs/` (see [`CONTRIBUTING.md`](../CONTRIBUTING.md#doc-sync-rule) → *Doc-sync rule*). Human review owns the pairings below. Tick what applies; if none apply, explain why in the description.

- [ ] Touched `backend/app/routers/**` → updated [`docs/api.md`](../docs/api.md)
- [ ] Touched `backend/app/models/**` or `backend/alembic/versions/**` → updated [`docs/data-model.md`](../docs/data-model.md) (table block **and** ER diagram)
- [ ] Touched `.github/workflows/**`, `backend/Dockerfile`, `backend/railway.json`, or `docker-compose.yml` → updated [`docs/engineering.md`](../docs/engineering.md)
- [ ] Touched production code (`backend/app/**`, `frontend/src/**`, or a migration) → added a one-line entry with the PR link under `## Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md)
- [ ] Tech-choice swap (not a routine version bump) → updated [`docs/engineering.md`](../docs/engineering.md)
- [ ] Auth model, deployment URLs, env vars, or primary dev workflow change → updated [`docs/engineering.md`](../docs/engineering.md) (*Local environment*, *Deployment*) **and** [`README.md`](../README.md)
- [ ] Palette recipe / shared style constant in [`styles.ts`](../frontend/src/components/ui/styles.ts) → updated [`docs/design.md`](../docs/design.md) (*Accent recipe*)

## Test plan

How you verified this. Include the commands you ran and, for UI changes, the flow you walked through in the browser.

- [ ] Ran the local CI commands in [`CONTRIBUTING.md`](../CONTRIBUTING.md#pull-request-flow) step 3
- [ ] Manual check of the affected user flow (describe below)

## Notes for the reviewer

Anything reviewer-only: known unknowns, follow-ups intentionally left out of this PR, edge cases you weighed but did not cover. Optional.
