# Security policy

## Reporting a vulnerability

**Please do not open a public GitHub issue.**

Report vulnerabilities privately through GitHub's **[*Report a vulnerability*](https://github.com/vidithq/vidit/security/advisories/new)** form (the *Security* tab on the repository). This routes the report to the maintainer through an encrypted GitHub-side channel and creates a private advisory we can collaborate in.

If GitHub's form is unavailable to you for any reason, send a brief description (no exploit details in the initial message) to `security@vidit.app` asking for an alternate channel.

## What to include

- A clear description of the vulnerability and its impact.
- A minimal proof-of-concept or reproduction steps.
- The affected version / commit SHA / endpoint.
- Optional: your suggested fix.

## Response timeline

| Stage | Target |
|---|---|
| Initial acknowledgement of the report | **within 7 days** |
| Triage + fix work | best-effort, kept in the private advisory |
| Public disclosure after a fix ships | **within 90 days** of fix release |

We will credit reporters who want credit in the advisory's *Credits* field. If you prefer to stay anonymous, say so in the report.

## Scope

In scope:
- Production application code under [`backend/`](backend/) and [`frontend/`](frontend/).
- Database schema and migrations under [`backend/alembic/`](backend/alembic/).
- CI / CD workflow files under [`.github/workflows/`](.github/workflows/).
- The deployed instance at `https://vidit.app` / `https://api.vidit.app` (please rate-limit your own testing — five requests per second is plenty).

Out of scope:
- **Rate limiting on a self-hosted deployment.** Rate-limit thresholds are a deployment choice; the configured values on the open codebase are not security boundaries for self-hosters.
- **Social-engineering attacks on the maintainer** or attempts to compromise maintainer accounts (these are not "Vidit vulnerabilities" — report them to the relevant provider).
- Findings that require physical access to a user's device or a privileged position on the user's network.
- Reports from automated scanners with no demonstrated impact (`X-Frame-Options` missing on a public marketing page, `Server:` header disclosure, etc.).
- Denial of service via overwhelming volume (load-test traffic). Application-layer DoS that exploits a specific code path is in scope.

## Safe-harbor

Good-faith security research that follows this policy will not be pursued legally by the maintainer. Please:
- Stop and report the moment you confirm a vulnerability — do not exfiltrate data, modify other accounts, or pivot further.
- Do not access, modify, or delete data that does not belong to you.
- Do not test against other users' content.

If your research accidentally accesses user data, stop, report immediately, and do not retain copies.
