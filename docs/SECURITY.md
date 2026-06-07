# Security policy

## Reporting a vulnerability

**Please do not open a public GitHub issue.**

Report vulnerabilities privately through GitHub's **[*Report a vulnerability*](https://github.com/vidithq/vidit/security/advisories/new)** form (the *Security* tab on the repository).

If GitHub's form is unavailable, email `security@vidit.app` (no exploit details) to request an alternate channel.

## What to include

- A clear description of the vulnerability and its impact.
- A minimal proof-of-concept or reproduction steps.
- The affected version / commit SHA / endpoint.
- Optional: your suggested fix.

## Response timeline

| Stage | Target |
|---|---|
| Initial acknowledgement of the report | **within 7 days** |
| Triage + fix | best-effort, in the advisory |
| Public disclosure after a fix ships | **within 90 days** of fix release |

Reporters are credited in the advisory's *Credits* field on request; say so in the report if you prefer anonymity.

## Scope

In scope:
- Production application code under [`backend/`](../backend/) and [`frontend/`](../frontend/).
- Database schema and migrations under [`backend/alembic/`](../backend/alembic/).
- CI / CD workflow files under [`.github/workflows/`](../.github/workflows/).
- The deployed instance at `https://vidit.app` / `https://api.vidit.app` (cap testing at 5 req/s).

Out of scope:
- **Rate limiting on a self-hosted deployment.** Configured values aren't security boundaries for self-hosters.
- **Social-engineering attacks on the maintainer** or attempts to compromise maintainer accounts (report to the relevant provider).
- Findings that require physical access to a user's device or a privileged position on the user's network.
- Automated-scanner findings with no demonstrated impact (`X-Frame-Options` missing on a public marketing page, `Server:` header disclosure, etc.).
- Volumetric DoS (load-test traffic); application-layer DoS via a specific code path is in scope.

## Safe-harbor

Good-faith research following this policy will not be pursued legally. Please:
- Stop and report the moment you confirm a vulnerability — do not exfiltrate data, modify other accounts, or pivot further.
- Do not access, modify, delete, or test against data or content that isn't yours.

If you accidentally access user data: stop, report, and do not retain copies.
