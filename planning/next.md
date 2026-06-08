# What's next

Work tracker organized by the macros defined in [`roadmap.md`](roadmap.md). Items get deleted when they ship — the [CHANGELOG](../CHANGELOG.md) records what landed.

Within each macro, rows carry a priority:

- **P0** — hard blocker; the macro doesn't ship without it.
- **P1** — strongly recommended; lands inside the macro if there's time.
- **P2** — nice-to-have; can slip without embarrassment.

The [Refactors](#refactors) at the bottom are ongoing engineering hygiene, not gated on any macro.

---

## M1 — Open source launch *(now)*

Strategic context: [`roadmap.md`](roadmap.md) → *M1*. What's already shipped: the public vitrine — landing + demo video (see [CHANGELOG](../CHANGELOG.md) under *Unreleased* and *v0.2.0*). What's left: the open-source flip + the pinned X tweet on [`@vidithq`](https://x.com/vidithq) + cold-reach DMs, all firing in the same window.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P0 | Security | Session-lifecycle invalidation — `users.token_version` column + `get_current_user` claim check + bumps on logout / password change / password reset / soft-delete | Today, clearing the session cookie doesn't invalidate the underlying token. **Implementation:** migration adds `users.token_version INTEGER NOT NULL DEFAULT 0`; [`services/auth.create_access_token`](../backend/app/services/auth.py) embeds it as a `tv` claim; [`dependencies.get_current_user`](../backend/app/dependencies.py) 401s on mismatch; `bump_token_version(user)` fires at the four mutation points. The full Tier-3 refresh-token system in M2 supersedes this; ship the interim fix first. Pair: tighten `/auth/reset-password` account-state guards to match mint side. |
| P0 | Vitrine | Re-record the promo video — not signed in as admin, clearer bounty preview | Current promo runs from the admin account, which betrays an internal-tester perspective. The bounty preview in the "working on this" segment doesn't read clearly. Pipeline: [`video/`](../video/) (`make promo`). |
| P1 | Vitrine | Replace the "Have an invite code?"-only CTA with a "Request access" affordance | [`HeroCtas.tsx:37`](../frontend/src/components/landing/HeroCtas.tsx:37) — the sole unsigned-out CTA presupposes the visitor already has an invite. Cold traffic that wants in hits a dead-end. Add a "Request access" affordance below the primary CTA: `DM @vidithq` + `ask in Discord` (both exist; no waitlist build needed). Plain `<p className="text-sm text-neutral-400">` with two `<a>` links, mirroring the orange link style used elsewhere on the landing. |
| P1 | Legal | DCO sign-off on inbound contributions | **Not** a CLA, no relicensing clause (inbound = outbound = AGPL-3.0, PostgreSQL / Mastodon shape). DCO has contributors certify they have the right to submit the code. Implementation: short "Contributor sign-off" section in [`CONTRIBUTING.md`](../CONTRIBUTING.md) + a `.github/workflows/dco.yml` enforcing `Signed-off-by:` on each commit. |
| P0 | Repo | README cold-read polish | Add: AGPL-3.0 license badge at the top; `[Live demo](https://vidit.app)` badge (and inline link below the one-liner); the promo video embedded inline via the GitHub-release / user-attachment route (upload the mp4 to a release or drag-drop in an issue → use the `https://github.com/user-attachments/...` URL so GitHub renders the player in-page rather than a bare external link); short "Why open source / why AGPL" blurb mirroring [`roadmap.md`](roadmap.md) → *Openness & transparency*, **promoted to the top of the README** (not the bottom — cold readers don't scroll); credit @geo27752 for demo-content consent in a new `## Acknowledgements` section at the bottom. Trim the existing `## License` section to just the technical facts once the blurb moves up. |
| P0 | Repo | Open Graph + Twitter card metadata on `/` and `/about` | [`page.tsx`](../frontend/src/app/page.tsx) + [`about/page.tsx`](../frontend/src/app/about/page.tsx) — current `metadata` exports carry only `title` + `description`. Pinned tweet renders a bland text card without `openGraph` + `twitter` blocks and an `og:image`. About page is also `"use client"` with no `Metadata` export — wrap in a `layout.tsx` or split the client part off. |
| P0 | Repo | Set the GitHub repo description + topics before the public flip | Description: the [`README`](../README.md) opener verbatim ("*A web platform for OSINT/GEOINT analysts to archive, reference, and visualize geolocations of armed-conflict events.*") — describes what Vidit *is*, not what it aspires to (the roadmap one-liner is a vision, wrong shape for a repo description). Topics (11, under GitHub's 20 limit): `osint`, `geoint`, `geolocation`, `armed-conflict`, `conflict-monitoring`, `nextjs`, `fastapi`, `postgis`, `maplibre`, `agpl-3-0`, `open-source`. `gh repo edit vidithq/vidit --description "…"` + `gh api -X PUT repos/vidithq/vidit/topics -f names[]=osint …`. |
| P2 | Repo | Public docs site via MkDocs Material → `docs.vidit.app` | Today's `docs/` is in-repo only — discoverable for contributors, not for analysts/evaluators. **Scope: `docs/` only** (api, backups, data-model, design, engineering) — pure reference site. `planning/` stays GitHub-only as a markdown tracker (roadmap remains readable on GitHub but unstyled; the landing's ROADMAP array already covers the public-facing projection). MkDocs Material reads `docs/*.md` with minimal restructuring (nav configured in a new `mkdocs.yml` at root, `docs_dir: docs`), builds via GitHub Actions, hosts on Cloudflare Pages or GitHub Pages, points `docs.vidit.app` at it. Matches the Astral / uv / Bun pattern of `docs/` = source for a hosted site. Add a `https://docs.vidit.app` link to the README's Documentation section (coordinate with the README polish row above). |
| P1 | Repo | Flip the repository public | The flip itself, once the rows above are done. |

---

## M2 — Open beta

Strategic context: [`roadmap.md`](roadmap.md) → *M2*. Every row here is a hard blocker.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P0 | Registration | Public self-registration form + retire invite codes | Anyone can sign up; the closed-beta invite-code path comes down. |
| P0 | Read access | Anonymous read — drop the auth requirement on read endpoints + public map / detail pages | Anyone browses the map and geolocation pages without an account. Anti-scraping rows below make it safe. |
| P0 | Anti-scraping | `?bbox=` required on `/geolocations/points` + viewport-driven map fetch | Catalog size stops mattering — viewport size matters. Kills the dominant Phase-3 cost line + the "one curl loads the catalog" vector. PostGIS `ST_MakeEnvelope` + MapLibre viewport listener. ~2 days. |
| P0 | Anti-scraping | Hard server-side `LIMIT 100` on every list endpoint + `Link: rel="next"` cursor | Single biggest other scraping mitigation. |
| P0 | Anti-scraping | Per-IP slowapi limits on read endpoints | `/geolocations/points` 10/min, list 30/min, detail 120/min, tags + users 60/min. Tune from real traffic. |
| P0 | Anti-scraping | Per-user limit on authenticated reads (~1000 req/hr) | Logged-in scraper rotating IPs still hits a wall. Keyed by `User.id`. |
| P0 | Anti-scraping | Cloudflare Bot Fight Mode + WAF managed rules | Free tier. Catches default `curl`/`python-requests` + scanner patterns. |
| P0 | Anti-scraping | CAPTCHA on register (Cloudflare Turnstile or hCaptcha) | No PII to Google. |
| P0 | Anti-scraping | Honeypot on register; tighten `/auth/register` rate limit from today's 10/hr/IP to 3/hr/IP + 20/day/IP | |
| P0 | Anti-scraping | Disposable-email blocklist on register | Friction, not perfection. |
| P0 | Auth | Tier 3 — 15-min access tokens + DB-backed refresh tokens + server-side logout | `refresh_tokens` table + `POST /auth/refresh` rotates pair + silent-refresh interceptor on 401. |
| P0 | Auth | Tier 4 — CSP `script-src 'self'` + `report-uri` | Tune iteratively from console violations. |
| P0 | Moderation | AWS Rekognition pipeline at upload | `DetectModerationLabels` images, `StartContentModeration` async videos. Persist labels on `Media`. |
| P0 | Moderation | CSAM scanning in front of S3 (Cloudflare free tool or PhotoDNA) | Non-negotiable in most jurisdictions. |
| P0 | Trust | `?vetted_only=…` filter on `/geolocations`, `/geolocations/points`, `/timeline`, `/bounties`, `/search` + frontend chips | Substantiation half shipped — this is the filter half. Persist in URL query string. |
| P0 | Legal | Form SAS legal entity | |
| P0 | Legal | Engage avocat IT — CGU / Politique de confidentialité / Mentions légales / takedown / hébergeur status | ~4–8 hours, ~6 weeks before public switch. |
| P0 | Legal | DSA notice-and-action mechanism (Article 16) | "Report this geolocation" becomes real. |
| P0 | Legal | DSA Article 12 point of contact + Article 24 annual transparency report | |
| P0 | Legal | DPAs with every sub-processor (AWS, Railway, Vercel, Cloudflare) | |
| P0 | Legal | GDPR Article 30 register of processing activities | |
| P0 | Legal | EU TCO 1-hour removal-order channel | 24/7 reachable. |
| P0 | Legal | Responsabilité Civile Professionnelle insurance + public content policy | Terrorism, copyright, droit à l'image, defamation. |

---

## M3 — Public v1

Strategic context: [`roadmap.md`](roadmap.md) → *M3*. Priorities are relative within the macro — P1 before P2; none of it blocks the open-beta gate.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P1 | Launch | Retire closed-beta framing — `ClosedBetaBanner`, the beta badge, invite-gate copy | |
| P1 | Anti-scraping | Sentry traffic anomaly alerts on read endpoints | 5× typical rate over 5 min. |
| P1 | Anti-scraping | Audit log 90-day retention; rotate to S3 cold storage | |
| P1 | Anti-scraping | Watermark "export my data" feature | Fingerprint JSON per user so leaks are traceable. |
| P1 | Moderation | UI sensitive-content gate wired to Rekognition labels | |
| P1 | Cost | Bake S3 cost doubling into budget (Object Lock + versioning) | ~$72 → ~$150/mo on S3 alone at 3 TB mature catalog. |
| P1 | Cost | Replace page-views-per-user guess with Sentry breadcrumb measurement | One breadcrumb per page load. Today's ~50 PVs/active-analyst is pulled from thin air. |
| P1 | Cost | CloudFront pricing-class-100 toggle | Caps egress to cheap regions; APAC egress is ~3× EU/US. |
| P1 | Cost | Compress `/geolocations/points` aggressively (Brotli + 6-byte base64 IDs) | 3–5× shrink after bbox filter. |
| P1 | Seed | ~5000 Ukraine + ~1000 Israel/Gaza geolocations | Real density for open-audience map. |
| P1 | Search | Filters beyond type pick (date / conflict tag / free tag / author / vetted-only) | Same set the map carries. Pair with vetted-only rollout above. |
| P1 | UX | Wire search-by-author on profile | Clickable analyst handles everywhere (cards, timeline, search). Pair with search slice-2 author filter. Deferred from closed beta — only pays back when there are enough analysts to discover. |
| P1 | UX | No-match-filter empty states (map / timeline / search) | Pair with the filter rollouts above — these only matter once filtering has a meaningful catalog to operate on. |
| P1 | Timeline | Follower / following list pages + frontend routes | Counters exist; lists don't. `GET /users/{username}/followers` etc. |
| P2 | Search | JSONB content search (proof body, bounty description) | Flatten via `jsonb_path_query_array` materialised into a column or trigger. |
| P2 | Search | URL-fragment search (host + path units) | Paste a tweet ID and find the geo. |
| P2 | Search | Infinite scroll per group | Cursor keyed by `(rank, created_at, id)`. |
| P2 | Search | `'english'` stemming opt-in | DDL one-line swap if "strikes" misses "strike". |
| P2 | Timeline | Bounties in the feed | Mixed ordering by `created_at desc`. |
| P2 | Timeline | Cursor pagination + infinite scroll | OFFSET stops scaling. |
| P2 | Timeline | Scope toggle (`Following` / `All`) | Opt-out from empty followed-set. |
| P2 | Timeline | Notifications — bind sidebar `notify` dot to real unread state | Last-read marker per user + `> last_read` count. |
| P2 | Timeline | Suggested analysts (curated → friend-of-friend) | One-hop relational self-join is fine. |
| P2 | Bounties | Notifications when claimed bounty is fulfilled by someone else | Collaborative-queue courtesy. Needs `/notifications`. |
| P2 | Bounties | Claim TTL (7 days) + reaper | Once claim graphs accumulate. |
| P2 | Bounties | Bounty-author marks a specific claimer's geo as "the answer" | Out of scope until queue ambiguity matters. |
| P2 | UX | RBAC on tag creation (admin-only) | Once tags become curated taxonomy. |
| P2 | UX | `/notifications` feed | Follows + report-status updates. |
| P2 | Seed | Real footage import flow (data-sharing agreement or CC-licensed sources) | Admin-page button reading a KMZ + posting. No standalone CLI. |

---

## Refactors

Engineering-hygiene work, not gated on any milestone — pick these up when they unblock the next feature or when the smell starts to bite. Order is rough priority.

| Area | Item | Why / how |
|---|---|---|
| Frontend | `useApiResource<T>(path)` hook | Eight pages reproduce the same `useState<T \| null>` + `useState<error>` + `useEffect(apiFetch.then.catch)` quartet; half silently swallow errors with `.catch(() => {})`. A single hook with abort-on-unmount + null-path-skip collapses ~30 lines per page to one + `if (error)`. Worst sites: [`geolocations/[id]/page.tsx:21`](../frontend/src/app/geolocations/[id]/page.tsx), [`bounties/[id]/page.tsx:33`](../frontend/src/app/bounties/[id]/page.tsx), [`timeline/page.tsx:34`](../frontend/src/app/timeline/page.tsx). Don't bake in 401-redirect — middleware already does it; just propagate. |
| Frontend | `<AuthCard>` + `<SingleEmailFlow>` extraction | Five `(auth)` pages are near-copies of the same `max-w-sm bg-neutral-900 border` card + email-input + idle/sending/sent/failed state-machine + "back to sign in" footer. After the split each page is ~30 lines of copy + the success message. |
| Backend | S3 orphan-sweep helper / context manager | `try: storage.delete_many(keys) except StorageDeleteError: logger.exception(...)` recurs 5 times across [`routers/bounties.py`](../backend/app/routers/bounties.py) + [`routers/geolocations.py`](../backend/app/routers/geolocations.py). Two of these also do the same `uploaded_keys += derivative_keys` collection loop upstream. Either a `sweep_keys(keys, context=...)` helper in [`services/storage.py`](../backend/app/services/storage.py) or a `with track_uploaded_keys() as keys:` context manager that auto-sweeps on exception. |
| Backend | `services/admin.py` — raise typed errors, not `HTTPException` | Only service file that imports + raises FastAPI's `HTTPException` ([`services/admin.py:6`](../backend/app/services/admin.py); raises at lines 180, 183, 217, 250, 316, 399). [`services/registration.py`](../backend/app/services/registration.py) gets the layering right with `RegistrationError` + a `_REGISTRATION_ERROR_STATUS` mapping in the router — mirror that pattern so the service stops reaching across the layer line. |
| Frontend | Split [`admin/page.tsx`](../frontend/src/app/admin/page.tsx) (1,211 lines, 6 panels) | One file holds `InviteCodesPanel`, `TrustPanel`, `GeolocationDeletePanel`, `DemoDataPanel`, `DemoBountiesPanel`, `MaintenancePanel`. The two demo panels are 95% the same shape — collapse into a single `<SeedWipePanel>` parameterised by endpoint helpers + renderers. Move each panel under `components/admin/`. Leaves `page.tsx` at ~60 lines of composition. |
| Frontend | Split map [`app/map/page.tsx`](../frontend/src/app/map/page.tsx) (547 lines) | Interleaves map render + filter panel (~140 lines) + detail side-panel (~200 lines) + data loading. Extract `<FilterPanel>` and `<DetailSidePanel>` into `components/map/`. The side-panel currently re-renders the geolocation markup that [`geolocations/[id]/page.tsx`](../frontend/src/app/geolocations/[id]/page.tsx) also renders — a shared `<GeolocationDetailBody>` is a worthwhile follow-on, but the split itself is the first move. |

---

## Unscheduled candidates

Concept-level only — **no commitment** to design or ship. Promote a candidate into a milestone once it's scoped; delete it when it's rejected (no headstone).

| Area | Item | Why / how |
|---|---|---|
| Gamification | Virtual community-credit rewards on fulfilled bounties | Visible counter on the profile, no money. Bounties (scheduled above) are the natural starting point. |
| Gamification | Achievement badges | First 100 geolocations, first bounty fulfilled, longest streak, top contributor by conflict, etc. |
| Gamification | Public leaderboards | Filterable by conflict + time window. |
| Gamification | Activity surfacing on the profile | Streaks, monthly activity bar. |
| Gamification | Conflict-specific contributor recognition | |
| Backup | Tighten the inline cron verify | Today's `pg_restore --list` only inspects the TOC, not the data section, so a dump truncated mid-DATA after the TOC was written would still upload looking clean. A `pg_restore --schema-only` into a scratch DB inside the cron container (~5s cost) would catch that and close the "successful-looking upload of a corrupt dump" gap between quarterly drills. |
| Backup | Schedule shift to weekday morning | `0 0 * * MON` fires when no one is watching; a weekday-morning slot (e.g. `0 9 * * TUE`) means a failure is noticed during waking hours and the Monday `aws s3 ls` ritual goes away. One-char change. |
| Backup | Nightly cadence | Weekly is fine for the closed-beta analyst pool; flip the cron expression to `0 0 * * *` once the population grows enough that a week of submissions is a meaningful loss. Storage cost difference is negligible under the existing 365d lifecycle. One-char change. |
| Backup | Object Lock on the backup bucket | The media bucket has GOVERNANCE / 365 days bucket-wide; the backup bucket has lifecycle expiration but no immutability layer. Locking weekly dumps for, say, 90 days would prevent both accidental and malicious erasure of the most recent recovery points by anyone holding the `<s3-admin>` profile. |
| Backup | Cross-region replication | Every weekly dump auto-mirrored to a second region (e.g. `vidit-backup-prod-us-east-1`) via S3 Replication Configuration. Today the entire backup catalog lives in eu-west-3, same blast radius as the production media bucket and the Railway PG. ~10 minutes of configuration once it matters. |
| Backup | Point-in-time recovery | Weekly dumps mean up to 7 days of writes lost in the worst case. Railway doesn't expose WAL archiving today, so PITR would require either migrating the DB off Railway or shipping WAL ourselves (`pg_receivewal` in a long-running container). Bigger project; worth it once the catalog is large enough to justify the operational complexity. |
| Backup | `amazon/aws-cli` v2 base image | Current Dockerfile installs the Debian `awscli` package (v1, in maintenance). v2 has newer SigV4 + checksum support and is the AWS-recommended path. Cosmetic for a one-call `s3 cp` today. |
| Backup | `pg_cron` schedule restore note | `pg_dump --no-acl` discards `cron.job` rows. If prod ever starts using `pg_cron` (declared in [`docker/init-db.sql`](../docker/init-db.sql) but not currently referenced by the production dump), the restore runbook needs a "reschedule cron jobs manually after restore" line and the drill needs to cover it. |
| Evidence | Video upload metadata strip | The upload pipeline strips EXIF / IPTC / XMP from images synchronously (JPEG / PNG / WebP) — see [`backend/app/services/evidence_processing.py`](../backend/app/services/evidence_processing.py). Video files (mp4 in particular) skip the strip today: mp4 atom-level fields and GPS-tagged QuickTime metadata need an ffmpeg pass we don't want in the synchronous request path. Land when either (a) an async worker queue exists so the strip can run off the upload critical path, or (b) video upload volume becomes a real fraction of evidence and the un-stripped metadata becomes a real (small) gap in the evidence-preservation promise. |
| Ops | Maintenance reaper scheduling | Three reaper jobs ship as on-demand admin-panel buttons today: `reap_auth_tokens` (expired sessions / refresh tokens), `reap_proof_image_orphans` (Tiptap inline images not referenced by any geolocation proof), and `reap_pending_registrations` (abandoned signups past the 24h TTL). Clicking the button when checking the dashboard is fine for now. Schedule via a Railway cron service (parallel to the backup cron). Single-file change once it matters — the reaper functions already exist server-side; only the Railway cron schedule + Dockerfile shim is missing. |
| Comms | External "what's in flight" surface | A pinned location for "yes, the X bug is known and being worked on" — either a `STATUS.md` at the repo root (read by anyone clicking through to the source) or a pinned message in the Discord channel. Today the pattern is repeated explanation in DMs. Pick a format when the same "is X being looked at?" question lands twice. |
| Brand | Branded status URL via Cloudflare redirect | UptimeRobot exposes a public status page on free tier (currently `https://stats.uptimerobot.com/<monitor-id>` for the `Vidit API health` monitor). The URL leaks the provider name and reads off-brand. A Cloudflare Redirect Rule on a `status.vidit.app` subdomain would 302 every visit to the underlying UptimeRobot URL — clean brand, no UptimeRobot upgrade needed. **DNS:** add a record for `status.vidit.app` and flip it to **Proxied** (orange cloud) — safe to proxy this one because the subdomain hosts no service and doesn't need Let's Encrypt (unlike the apex and `api.` where proxy mode breaks cert provisioning, see [`engineering.md`](../docs/engineering.md) → *Particularities*). **Cloudflare → Rules → Single Redirect:** match `http.host eq "status.vidit.app"` → dynamic redirect to `https://stats.uptimerobot.com/<monitor-id>`, status 302. Free on all Cloudflare plans. Worth wiring once the status page becomes something analysts are asked to check; not urgent until then. |
| UX | Mobile responsiveness audit | A mobile pass across the golden paths (map → detail → submit → profile → admin under 375px) was scoped once, then de-prioritized: desktop is the only target surface for the closed beta. The audit can come back if and when public registration is on the table (M2), where casual visitors on phones become a real population. What it would cover when it surfaces: filter panel on the map taking too much width and burying data points; card-header CTAs (e.g. `/bounties` "Post bounty") wrapping at narrow widths; long-prose pages (`/about`) rendering at large body-text sizes that don't read like a phone UI; file-input controls leaking the browser-default truncated "Choose files / No file chosen" label. |

**Cross-cutting rules:**

- **Gamification stays separate from trust.** Scores, badges, and streaks must never influence the `trusted_contributor` flag and must never appear in the same UI surface as the trust filter. The platform's quality model rests on admin-curated trust + per-action moderation, not reputation math (see [`roadmap.md`](roadmap.md) → *Future considerations → Trust + governance*).
- **Backup hardening is pick-up-reactively.** The quarterly drill stays the canonical "is the backup real" check; deviation from the current weekly cron only when one of the rows above hits a concrete trigger.
