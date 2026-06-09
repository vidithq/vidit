<!--
Title: Conventional Commit format — `type(scope): subject`, subject starts lowercase.
Enforced by .github/workflows/pr-title.yml. Examples in CONTRIBUTING.md.
-->

## Summary

What this change does, in one to three sentences. Link the issue it closes (`Closes #N`) if there is one.

## Why

Why this is the right change — the user problem, the constraint, the trade-off. Skip if the summary already covers it.

## Doc-sync checklist

CI hard-fails the PR if `docs/` AND `planning/` aren't both touched (the `docs-pairing` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). The bullets below are the conventions human review still owns — tick what applies; if none apply, explain why in the description.

- [ ] Touched `backend/app/routers/**` → updated [`docs/api.md`](../docs/api.md)
- [ ] Touched `backend/app/models/**` or `backend/alembic/versions/**` → updated [`docs/data-model.md`](../docs/data-model.md) (table block **and** ER diagram)
- [ ] Touched `.github/workflows/**`, `backend/Dockerfile`, `backend/railway.json`, or `docker-compose.yml` → updated [`docs/engineering.md`](../docs/engineering.md)
- [ ] Touched production code (`backend/app/**`, `frontend/src/**`, or a migration) → added a one-line entry under `## Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md)
- [ ] Tech-choice swap (not a routine version bump) → updated [`docs/engineering.md`](../docs/engineering.md)
- [ ] Auth model, deployment URLs, env vars, or primary dev workflow change → updated [`AGENTS.md`](../AGENTS.md) **and** [`README.md`](../README.md)
- [ ] Palette recipe / shared style constant in [`styles.ts`](../frontend/src/components/ui/styles.ts) → updated [`docs/design.md`](../docs/design.md) (*Orange palette recipe*)
- [ ] Shipped item removed from [`planning/next.md`](../planning/next.md) (or briefly noted in the relevant macro)

## Test plan

How you verified this. Include the commands you ran (`make test`, `npm run lint`, etc.) and, for UI changes, the flow you walked through in the browser.

- [ ] `make test` passes locally
- [ ] Frontend `npm test` + `npm run lint` + `npx tsc --noEmit` + `npm run build` pass
- [ ] Manual check of the affected user flow (describe below)

## Notes for the reviewer

Anything reviewer-only: known unknowns, follow-ups intentionally left out of this PR, edge cases you weighed but did not cover. Optional.
