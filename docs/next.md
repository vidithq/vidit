# What's next

Forward-looking work list, ordered by milestone. Items get deleted when they ship — the [CHANGELOG](../CHANGELOG.md) records what landed. No status legend on rows: open or absent.

The path from closed beta to public v1 is four milestones. The throughline is **progressive openness**: show the substance, open the code, open the doors, then call it done. Reach is the current bottleneck and the community is skeptical of closed / unknown tools, so each milestone is also a trust signal — sequenced cheapest-and-loudest first.

| Milestone | What it delivers | What it unlocks |
|---|---|---|
| **M1 — Visibility** *(now)* | Public vitrine at `vidit.app` (pitch + about video + public roadmap); the about video reused as the pinned X tweet | A skeptic can evaluate Vidit without an account; first analyst invites land |
| **M2 — Open source** *(before v1)* | Open/proprietary scope call, license, git-history secrets scrub, contributor repo polish, flip public | Directly rebuts "closed-source / vibe-coded"; the code becomes the credibility proof |
| **M3 — Open beta** | Anonymous read + open self-registration, behind the safety + legal stack | Anyone can read and register; the trust filter becomes the curated layer on top |
| **M4 — Public v1** | Catalog density, search / social polish, cost tuning, beta framing removed | Full release |

Within each milestone, rows carry a priority:

- **P0** — hard blocker; the milestone doesn't ship without it.
- **P1** — strongly recommended; lands inside the milestone if there's time.
- **P2** — nice-to-have; can slip without embarrassment.

The [Refactors](#refactors) at the bottom are ongoing engineering hygiene, not gated on any milestone.

---

## M1 — Visibility & first analysts *(now)*

Outward-facing trust-building. Not gated on the Phase 3 safety stack — this is the stand-alone substance that lets a skeptical analyst judge Vidit before committing to an account, and the lever on the current reach bottleneck. Supports the live objective: issue the first analyst invites.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P0 | Vitrine | About video — 30–60s screen capture | Map → geolocation detail → submission. Substance over slides. The landing already ships the embed slot — set `NEXT_PUBLIC_DEMO_VIDEO_URL` (a YouTube/Vimeo embed URL or a direct `.mp4`) to light it up. Also set as the pinned tweet on [@vidithq](https://x.com/vidithq); reusable when replying to skeptics in DMs / threads. |
| P0 | Security | Session-lifecycle invalidation — `users.token_version` column + `get_current_user` claim check + bumps on logout / password change / password reset / soft-delete | Deferred from PR #100 (`/code-review ultra` follow-up). Clearing the session cookie on logout / password change / password reset / soft-delete doesn't invalidate the underlying token, so session revocation isn't immediate. **Implementation:** Alembic migration adds `users.token_version INTEGER NOT NULL DEFAULT 0`; [`services/auth.create_access_token`](../backend/app/services/auth.py) embeds it as a `tv` claim alongside `sub`; [`dependencies.get_current_user`](../backend/app/dependencies.py) compares the claim to the user row and 401s on mismatch; a `bump_token_version(user)` helper is called from the four mutation points above. The full Tier-3 refresh-token system in M3 supersedes this — ship the interim fix before the first analyst invite. Pair in the same PR: tighten the account-state guards on `/auth/reset-password` to match the mint side. |
| P1 | Security | Reserve the invite code atomically at `/auth/register` | Deferred from PR #100. [`services/registration.create_pending_registration`](../backend/app/services/registration.py) validates the invite but doesn't consume it until confirm, so one invite can hold several pending (email, username) reservations at once (each bounded by the 24h pending TTL). **Implementation:** call `consume_invite_code` inside `create_pending_registration` (the slot is then held by the pending row); on the expiry reaper, atomically return `use_count` for each expired row's invite (`UPDATE invite_codes SET use_count = use_count - 1 WHERE id = … AND use_count > 0`); the confirm path then verifies rather than re-consumes. Lower priority than the row above — closed-beta-bounded (requires a valid invite). |

---

## M2 — Open source *(before v1)*

The strongest and cheapest answer to the "closed-source / unknown / vibe-coded" objection, and orthogonal to the M3 safety stack — so it can run in parallel with M3 prep and should land well before the v1 launch. **100% open source under [AGPL-3.0](../LICENSE)** — no proprietary tier. The monetization layer on the maintainer's hosted instance is API rate limits + a small set of paid-only endpoints (see [`roadmap.md`](roadmap.md) → *Openness & transparency*). This milestone is mostly a scoping + hygiene exercise, not feature work.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P0 | Security | Git-history identity scrub | Audit history for personal identifiers and rewrite to a project-scoped identity before the repo goes public. A prior secrets audit found no committed secrets, so the rewrite is an identity-only `git filter-repo` pass. The cut-over sequence (account migration, repo rename, scrub, push, integration re-link, public flip) is tracked off-repo because it names the very identifiers being scrubbed. Non-negotiable gate on flipping public. |
| P1 | Repo | Flip the repository public | The actual switch, once the runbook above has been executed end-to-end. |

---

## M3 — Open beta

Stage 3a of [Phase 3](roadmap.md). Opens **anonymous read** and **open self-registration**; the invite-code gate is retired. The threat model widens to anonymous scrapers, account-farmers, and unknown content — so every row here is a hard blocker: you cannot safely or legally let the public in without it. The trusted-contributor flag ships here too, as the curated filter on top — never a gate.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P0 | Registration | Public self-registration form + retire invite codes | The keystone of open beta: anyone can sign up; the closed-beta invite-code path comes down. The CAPTCHA / honeypot / disposable-email / rate-limit rows below are what harden this form. |
| P0 | Read access | Anonymous read — drop the auth requirement on read endpoints + public map / detail pages | The other keystone: anyone browses the map and geolocation pages without an account. The anti-scraping rows below are what make open read safe. |
| P0 | Anti-scraping | `?bbox=` required on `/geolocations/points` + viewport-driven map fetch | **Single highest-leverage item in this whole milestone.** Catalog size stops mattering — viewport size matters. Kills the dominant Phase-3 cost line + the "one curl loads the catalog" vector. PostGIS `ST_MakeEnvelope` + MapLibre viewport listener. ~2 days. |
| P0 | Anti-scraping | Hard server-side `LIMIT 100` on every list endpoint + `Link: rel="next"` cursor | Single biggest other scraping mitigation. |
| P0 | Anti-scraping | Per-IP slowapi limits on read endpoints | `/geolocations/points` 10/min, list 30/min, detail 120/min, tags + users 60/min. Tune from real traffic. |
| P0 | Anti-scraping | Per-user limit on authenticated reads (~1000 req/hr) | Logged-in scraper rotating IPs still hits a wall. Keyed by `User.id`. |
| P0 | Anti-scraping | Cloudflare Bot Fight Mode + WAF managed rules | Free tier. Catches default `curl`/`python-requests` + scanner patterns. |
| P0 | Anti-scraping | CAPTCHA on register (Cloudflare Turnstile or hCaptcha) | No PII to Google. |
| P0 | Anti-scraping | Honeypot on register; tighten `/auth/register` rate limit from today's 10/hr/IP to 3/hr/IP + 20/day/IP | |
| P0 | Anti-scraping | Disposable-email blocklist on register | Friction, not perfection. |
| P0 | Auth | Tier 3 — 15-min access tokens + DB-backed refresh tokens + server-side logout | `refresh_tokens` table + `POST /auth/refresh` rotates pair + silent-refresh interceptor on 401. Today's `POST /auth/logout` clears cookies; this adds server-side token revocation. |
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

## M4 — Public v1 (full release)

Stage 3b of [Phase 3](roadmap.md). The open beta proven out and finished into v1: real catalog density, search and social depth, cost tuning, and the closed-beta framing removed. Open source (M2) has already landed by here. Priorities are relative within the milestone — P1 before P2; none of it blocks the open-beta gate.

| Pri | Area | Item | Why / how |
|---|---|---|---|
| P1 | Launch | Retire closed-beta framing — `ClosedBetaBanner`, the beta badge, invite-gate copy | The "closed beta" banner + version badge + invite-only messaging come down when the platform is a full release. |
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

Engineering-hygiene work surfaced by the pre-invite code audit. Not gated on any milestone — pick these up when they unblock the next feature or when the smell starts to bite. Order is rough priority within this list.

| Area | Item | Why / how |
|---|---|---|
| Frontend | `useApiResource<T>(path)` hook | Eight pages reproduce the same `useState<T \| null>` + `useState<error>` + `useEffect(apiFetch.then.catch)` quartet; half silently swallow errors with `.catch(() => {})`. A single hook with abort-on-unmount + null-path-skip baked in collapses ~30 lines of boilerplate per page to one line + `if (error)`. Worst sites: [`geolocations/[id]/page.tsx:21`](../frontend/src/app/geolocations/[id]/page.tsx), [`bounties/[id]/page.tsx:33`](../frontend/src/app/bounties/[id]/page.tsx), [`timeline/page.tsx:34`](../frontend/src/app/timeline/page.tsx). Don't bake in 401-redirect — middleware already does it; just propagate. |
| Frontend | `<AuthCard>` + `<SingleEmailFlow>` extraction | Five `(auth)` pages are near-copies of the same `max-w-sm bg-neutral-900 border` card + email-input + idle/sending/sent/failed state-machine + "back to sign in" footer. [`forgot-password`](../frontend/src/app/(auth)/forgot-password/page.tsx) and [`resend-confirmation`](../frontend/src/app/(auth)/resend-confirmation/page.tsx) are literally the same control flow with a different endpoint. After the split each page is ~30 lines of copy + the success message. |
| Backend | S3 orphan-sweep helper / context manager | `try: storage.delete_many(keys) except StorageDeleteError: logger.exception(...)` recurs 5 times across [`routers/bounties.py`](../backend/app/routers/bounties.py) + [`routers/geolocations.py`](../backend/app/routers/geolocations.py). Two of these also do the same `uploaded_keys += derivative_keys` collection loop upstream. Orphan-leak severity earns the abstraction — either a `sweep_keys(keys, context=...)` helper in [`services/storage.py`](../backend/app/services/storage.py) or a `with track_uploaded_keys() as keys:` context manager that auto-sweeps on exception. |
| Backend | `services/admin.py` — raise typed errors, not `HTTPException` | Only service file that imports + raises FastAPI's `HTTPException` ([`services/admin.py:6`](../backend/app/services/admin.py); raises at lines 180, 183, 217, 250, 316, 399). [`services/registration.py`](../backend/app/services/registration.py) gets the layering right with `RegistrationError` + a `_REGISTRATION_ERROR_STATUS` mapping in the router — mirror that pattern so the service stops reaching across the layer line. |
| Frontend | Split [`admin/page.tsx`](../frontend/src/app/admin/page.tsx) (1,211 lines, 6 panels) | One file holds `InviteCodesPanel`, `TrustPanel`, `GeolocationDeletePanel`, `DemoDataPanel`, `DemoBountiesPanel`, `MaintenancePanel`. The two demo panels are 95% the same shape — collapse into a single `<SeedWipePanel>` parameterised by endpoint helpers + renderers. Move each panel under `components/admin/`. Leaves `page.tsx` at ~60 lines of composition. |
| Frontend | Split map [`app/map/page.tsx`](../frontend/src/app/map/page.tsx) (547 lines) | Interleaves map render + filter panel (~140 lines) + detail side-panel (~200 lines) + data loading. Extract `<FilterPanel>` and `<DetailSidePanel>` into `components/map/`. The side-panel currently re-renders the geolocation markup that [`geolocations/[id]/page.tsx`](../frontend/src/app/geolocations/[id]/page.tsx) also renders — a shared `<GeolocationDetailBody>` is a worthwhile follow-on, but the split itself is the first move. |

---

## Unscheduled candidates

Concept-level only — **no commitment** to design or ship. Distinct from the milestones above: those are scheduled work; these are directions we've talked about but haven't scoped or timed. Promote a candidate into a milestone once it's scoped; delete it when it's rejected (no headstone).

### Gamification

The platform's quality model rests on two things: the admin-curated `trusted_contributor` flag (with a reader-facing filter), and per-action moderation. There is no in-platform reputation math — explicitly out of scope per [`roadmap.md`](roadmap.md). Registration itself is open from Phase 3 onward (closed beta uses invite codes); credibility shows up only via the trust mark, not via what someone can or can't do.

Within that model, lightweight gamification could reinforce engagement without leaking into the trust signal or the readers' filter. Bounties (scheduled above) are the natural place to start.

Surface area to think about, none of it specced:

- Virtual community-credit rewards on fulfilled bounties — visible counter on the profile, no money.
- Achievement badges (first 100 geolocations, first bounty fulfilled, longest streak, top contributor by conflict, etc.).
- Public leaderboards filterable by conflict + time window.
- Activity surfacing on the profile — streaks, monthly activity bar.
- Conflict-specific contributor recognition.

**Rule for if any of this ships:** gamification primitives stay **separate** from the trust signal. Scores, badges, and streaks should never influence whether someone gets the `trusted_contributor` checkmark, and they should never appear in the same UI surface as the trust filter. Gamification is for engagement and community texture, not authority.

### Backup hardening

The weekly `pg_dump` → S3 cron (landed v0.0.10, see [`docs/backups.md`](backups.md)) is deliberately the minimum-viable shape for the closed-beta gate: small DB, low write volume, quarterly drill as the canonical verifier, weekly cadence picked over nightly because the cost of a week of lost submissions is small at this scale. Several hardening directions are tracked here in case the catalog grows, prod migrates platforms, or an incident reveals a real failure mode. None of these are blocking the closed-beta gate.

- **Tighten the inline cron verify** — today's `pg_restore --list` only inspects the TOC, not the data section, so a dump truncated mid-DATA after the TOC was written would still upload looking clean. A `pg_restore --schema-only` into a scratch DB inside the cron container (~5s cost) would catch that and close the "successful-looking upload of a corrupt dump" gap between quarterly drills.
- **Schedule shift to weekday morning** — `0 0 * * MON` fires when no one is watching; a weekday-morning slot (e.g. `0 9 * * TUE`) means a failure is noticed during waking hours and the Monday `aws s3 ls` ritual goes away. One-char change.
- **Nightly cadence** — weekly is fine for the closed-beta analyst pool; flip the cron expression to `0 0 * * *` once the population grows enough that a week of submissions is a meaningful loss. Storage cost difference is negligible under the existing 365d lifecycle. One-char change.
- **Object Lock on the backup bucket** — the media bucket has GOVERNANCE / 365 days bucket-wide; the backup bucket has lifecycle expiration but no immutability layer. Locking weekly dumps for, say, 90 days would prevent both accidental and malicious erasure of the most recent recovery points by anyone holding the `<s3-admin>` profile.
- **Cross-region replication** — every weekly dump auto-mirrored to a second region (e.g. `vidit-backup-prod-us-east-1`) via S3 Replication Configuration. Today the entire backup catalog lives in eu-west-3, same blast radius as the production media bucket and the Railway PG. ~10 minutes of configuration once it matters.
- **Point-in-time recovery** — weekly dumps mean up to 7 days of writes lost in the worst case. Railway doesn't expose WAL archiving today, so PITR would require either migrating the DB off Railway or shipping WAL ourselves (`pg_receivewal` in a long-running container). Bigger project; only worth it once the catalog is large enough to justify the operational complexity.
- **`amazon/aws-cli` v2 base image** — current Dockerfile installs the Debian `awscli` package (v1, in maintenance). v2 has newer SigV4 + checksum support and is the AWS-recommended path. Cosmetic for a one-call `s3 cp` today.
- **`pg_cron` schedule restore note** — `pg_dump --no-acl` discards `cron.job` rows. If prod ever starts using `pg_cron` (declared in [`docker/init-db.sql`](../docker/init-db.sql) but not currently referenced by the production dump), the restore runbook needs a "reschedule cron jobs manually after restore" line and the drill needs to cover it.

Pick these up reactively — when an incident reveals the failure mode, when prod grows enough to need PITR, when AWS deprecates v1, when analyst count makes weekly cadence uncomfortable. The quarterly drill stays the canonical "is the backup real" check in all cases.

### Video upload metadata strip

The upload pipeline strips EXIF / IPTC / XMP from images synchronously (JPEG / PNG / WebP) — see [`backend/app/services/evidence_processing.py`](../backend/app/services/evidence_processing.py). Video files (mp4 in particular) skip the strip today: mp4 atom-level fields and GPS-tagged QuickTime metadata need an ffmpeg pass we don't want in the synchronous request path. Land when either (a) an async worker queue exists so the strip can run off the upload critical path, or (b) video upload volume becomes a real fraction of evidence and the un-stripped metadata becomes a real (small) gap in the evidence-preservation promise. Until then, document the carve-out on the /about page if volume rises.

### Maintenance reaper scheduling

Two reaper jobs ship as on-demand admin-panel buttons today: `reap_auth_tokens` (expired sessions / refresh tokens) and `reap_proof_image_orphans` (Tiptap inline images not referenced by any geolocation proof). At closed-beta scale, clicking the button when checking the dashboard is fine. Schedule them via a Railway cron service (parallel to the backup cron) once the analyst pool grows enough that orphan accumulation becomes a real cost or admin-load line. Single-file change once it matters — the reaper functions already exist server-side; only the Railway cron schedule + Dockerfile shim is missing.

### External "what's in flight" surface

A pinned location for "yes, the X bug is known and being worked on" — either a `STATUS.md` at the repo root (read by anyone clicking through to the source) or a pinned message in the Discord channel. Today the pattern is repeated explanation in DMs; not a problem at 0 analysts, becomes one at 5–10. Pick a format when the same "is X being looked at?" question lands twice.

### Branded status URL via Cloudflare redirect

UptimeRobot exposes a public status page on free tier (currently `https://stats.uptimerobot.com/<monitor-id>` for the `Vidit API health` monitor). The URL works but leaks the provider name and reads as an off-brand SaaS link wherever it's surfaced (tickets, `/about`, pinned Discord). A Cloudflare Redirect Rule on a `status.vidit.app` subdomain would 302 every visit to the underlying UptimeRobot URL — clean brand, no UptimeRobot upgrade needed:

- DNS: add a record for `status.vidit.app` and flip it to **Proxied** (orange cloud). Safe to proxy this one because the subdomain hosts no service of its own and doesn't need Let's Encrypt — unlike the apex and `api.` where proxy mode breaks cert provisioning (see [`architecture.md`](architecture.md) → *Particularities*).
- Cloudflare → Rules → Single Redirect: match `http.host eq "status.vidit.app"` → dynamic redirect to `https://stats.uptimerobot.com/<monitor-id>`, status 302. Free on all Cloudflare plans.

Worth wiring once the status page becomes something analysts are asked to check (linked from `/about`, pinned in Discord); not urgent at closed-beta scale where the audience is single-digit and a direct UptimeRobot URL won't be seen by many people anyway.

### Mobile responsiveness audit

A mobile pass across the golden paths (map → detail → submit → profile → admin under 375px) was scoped once, then de-prioritized: desktop is the only target surface for the closed beta — analysts joining will be working from a real workstation, not a phone. The audit can come back if and when public registration is on the table (Phase 3), where casual visitors on phones become a real population.

What that audit would cover when it surfaces:

- Filter panel on the map taking too much width and burying the data points.
- Card-header CTAs (e.g. `/bounties` "Post bounty") wrapping at narrow widths.
- Long-prose pages (`/about`) rendering at large body-text sizes that don't read like a phone UI.
- File-input controls leaking the browser-default truncated "Choose files / No file chosen" label.
