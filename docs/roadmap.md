# Roadmap

> Core goal: become the home of the OSINT/GEOINT community.
> **Quality through admin-curated trust marks + content moderation, not reputation math** — readers can always filter to vetted analysts.
> **Openness is the strategy** — a public roadmap, and the code open-sourced before the v1 launch (see *Openness & transparency* below).
> A bad first impression is hard to recover from.
> Priorities adjust based on beta feedback.

What's currently open — across phases — lives in [`next.md`](next.md), organised into the three milestones. What's already shipped lives in [`CHANGELOG.md`](CHANGELOG.md).

---

## Vision

### The problem

OSINT/GEOINT analysts who geolocate armed-conflict events have no dedicated, open, professional tool to archive and share their work.

The current workflow is fragmented: geolocations are posted to Twitter, with no structured format and no place to centralize them. The few dedicated tools that exist tend to be closed to part of the community and ship with dated interfaces.

### The solution

A web platform where analysts reference, archive, and visualize geolocations of armed-conflict events.

### Primary persona — the OSINT/GEOINT analyst

**Who they are.**
An enthusiast (amateur or professional) who collects media (images, videos) from armed conflicts via open sources: Twitter/X, Telegram, Signal, satellite-imagery providers, etc. They use visual cues in the media to pin down where it was filmed.

**Where they live.**
Mostly on Twitter/X and Discord. The community is international, English-speaking, and active around major conflicts (Ukraine, Middle East, sub-Saharan Africa…).

**Their current frustrations**
- No standardized format for sharing a geolocation
- Work scattered across Twitter, hard to retrieve and archive
- Existing tools are closed (restricted access, not open to the whole community)
- Interfaces feel rough and don't reflect the quality of the work

**What they're looking for**
- A single place to centralize and archive their geolocations
- A structured, readable format to present their proof
- An interactive map to visualize all events
- A tool they can recommend to their community

### Guiding principles

1. **Openness** — the platform must be accessible to as many people as possible, with no artificial barriers.
2. **Simplicity** — the UI must be intuitive. Posting a geolocation should take less than two minutes.
3. **Quality** — the design and experience must match the seriousness of the community.
4. **Neutrality** — the platform references geolocated facts, not political stances.

---

## Phase 1 — Closed beta

**Goal:** validate that the tool answers the need.

Five MVP features:

1. Invite-only auth (registration via invite code, login/logout)
2. Interactive world map with conflict/tag filtering, click → geolocation page
3. Geolocation submission (coords + source URL + media + Tiptap proof with images + tags + event date)
4. Geolocation page (map, media, proof, metadata)
5. Analyst profile (list of their geolocations)

**Exit criterion:** invited analysts use the tool without friction; feedback is positive.

### What we're not building in the MVP

- Reputation or trust-score system
- Community validation / moderation
- Collaboration on an existing geolocation
- Notifications
- Public API
- Native mobile app
- Bulk import

---

## Phase 2 — Curated-platform consolidation

**Goal:** make the platform feel finished as a community — social/discovery features (follow, timeline, search, bounties), the admin panel, profile expansion, UX polish. The trusted-contributor flag and its filter ship together with open registration in [Phase 3](#phase-3--public-launch) (the flag becomes a meaningful filter only when the analyst pool is heterogeneous).

Confidence levels, co-validation, comments, and reputation systems are dropped — see *[Explicitly out of scope](#explicitly-out-of-scope)*.

### Profile & identity
- Bio + external links on the profile (linktree-style: X, Discord, website, GitHub).
- Twitter/X account link on the profile (identity anchor).

### Moderation (lightweight, admin-driven)
- **Report this content** → admin review queue. No community vote, reputation impact, or thresholding.
- Sensitive-content gate UI on geolocation media (ties to AWS Rekognition + Cloudflare CSAM scanning at upload — see [`next.md`](next.md)).
- Admin panel: review reports, manage users, grant/revoke the trusted-contributor flag, manage the canonical conflict list, suspend/ban.
- Roles: **admin** and **analyst** (no separate "moderator" role at this scale).

### Social graph (no trust math)
- Follow / unfollow analysts.
- Timeline feed of new geolocations and bounties from followed analysts (with a "vetted only" filter on top).
- Notifications page (followed-analyst posts, mentions, report-status updates).
- Search across geolocations, analysts, and bounties (full-text + filters; per-entity result groups).
- Bounties: open requests for a geolocation that another analyst can claim and fulfil. See [`next.md`](next.md) for scope.

### UX & performance
- Responsive UI — deferred; desktop-first through closed beta (see [`next.md`](next.md)).
- Map performance at large volume.
- Advanced filters (conflict, geographic area, date, analyst).
- Open Graph metadata on geolocation pages (Twitter/Discord sharing).

**Exit criterion:** the social-graph features (follow, timeline, search, bounties) are live for invited analysts, the admin panel handles invite minting / soft-deletion / reports without external tooling, and the profile expansion (bio, external links, X identity) is in place.

---

## Phase 3 — Public launch

**Goal:** open the platform — anonymous read for everyone, open self-registration for anyone who wants to contribute. Reached in two stages: **3a — open beta**, then **3b — public v1**.

- **Public read access** — anyone can browse the map and geolocation pages without an account.
- **Open registration** — invite codes are retired. Anyone can sign up via the public registration form (CAPTCHA, honeypot, disposable-email blocklist, rate limits — see [`next.md`](next.md)).
- **Trusted-contributor flag** ships here — single bit, admin-granted via an opt-in "Request analyst access" form, paired with a required `trust_reason` note explaining the basis (track record, profession, established X handle, etc.). The badge is **visible and filterable**: clicking it surfaces the `trust_reason`; filter chips on the map, timeline, search, and bounty index let readers scope to vetted-only. See [`next.md`](next.md) for scope.
- Public landing page explaining the platform.

The asymmetry: **read is open, write is open after registration, the trust flag is a curated quality filter on top.** Quality protection sits at three layers: anti-abuse on registration, content moderation on uploads, and the trust filter for readers.

### Stage 3a — Open beta

Open the doors behind the hard safety + legal stack, with a beta badge still on. Anti-scraping, full Tier 3 + 4 auth hardening, content moderation, the trust-reason field on vetted analysts, and legal pre-flight all gate this stage. See [`next.md`](next.md). The codebase is **already open-source by this point** (see *Openness & transparency*).

### Stage 3b — Public v1

Open beta hardened into v1: catalog density, search and social depth, cost tuning, closed-beta framing removed. See [`next.md`](next.md).

---

## Phase 4 — Long-term enrichment

**Goal:** deepen the value of every geolocation.

Open candidates, prioritised later based on real usage:

- Automated source archival (Wayback Machine / archive.today) for every submission, so links survive X URL rotation.
- OCR on uploaded media to make captions and signage searchable.
- Related-events suggestions on a geolocation page.
- Translation of proof text between major languages.
- Public read-only API (rate-limited).
- Native mobile companion app.

---

## Openness & transparency (cross-cutting)

Two moves:

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** Nothing is proprietary. Monetization on the maintainer's hosted instance (`vidit.app`) is **API rate limits + paid-only endpoints** (saved-search alert webhooks, larger exports). AGPL keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing projection of these milestones ships on the public landing. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source.

The throughline is **progressive openness**: open the source, open the doors (Phase 3a), then v1 (Phase 3b). Operational plan: [`next.md`](next.md).

---

## Explicitly out of scope

| Feature | Why |
|---------|-----|
| Confidence levels per submission (low/med/high) | The trust filter on the author already lets readers scope to known-credible submissions; per-action scoring adds noise without clear product value |
| Co-validation by other analysts | Same reason — readers filter by author trust, no per-submission voting needed |
| Comments / discussion threads | High abuse surface, low product value, large DSA UGC moderation burden |
| Reputation system per scope/conflict | The admin-curated trust flag plus content moderation is sufficient; per-scope scores add no product value the trust filter doesn't already provide and are gameable (Goodhart) |
| Community-driven moderation governance | Community is too small for democracy; admin-driven is faster and cleaner |
| Bulk import / external-source ingestion at runtime | One-shot seed scripts already cover OSINT exports |
| Monetization | Not defined |
