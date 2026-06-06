# Roadmap

> Core goal: become the home of the OSINT/GEOINT community.
> **Quality through admin-curated trust marks + content moderation, not reputation math** — readers can always filter to vetted analysts when they want a higher signal-to-noise.
> **Openness is the strategy, not just a value** — a public roadmap, and the code open-sourced before the v1 launch (see *Openness & transparency* below). Reach into a skeptical community is the bottleneck; progressive openness is how trust gets earned.
> A bad first impression is hard to recover from.
> Priorities adjust based on beta feedback.

What's currently open — across phases — lives in [`next.md`](next.md), organised into the three milestones that carry the platform from closed beta to public v1. What's already shipped lives in [`CHANGELOG.md`](../CHANGELOG.md). This file describes the *direction*: the four phases and what each one means.

---

## Phase 1 — Closed beta (current)

**Goal:** validate that the tool answers the basic need.

Five MVP features:

1. Invite-only auth (registration via invite code, login/logout)
2. Interactive world map with conflict/tag filtering, click → geolocation page
3. Geolocation submission (coords + source URL + media + Tiptap proof with images + tags + event date)
4. Geolocation page (map, media, proof, metadata)
5. Analyst profile (list of their geolocations)

Code is shipped and deployed (see [CHANGELOG](../CHANGELOG.md)). The closed beta is live with the first wave of analysts; remaining work for widening that pool — the M1 open-source launch — is in [`next.md`](next.md).

**Exit criterion:** invited analysts use the tool without friction; qualitative feedback on the core experience is positive.

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

**Goal:** make the platform feel finished as a community — social/discovery features (follow, timeline, search, bounties), the admin panel, profile expansion, UX polish. Registration model unchanged from Phase 1: still invite-code-based. The trusted-contributor flag and its filter ship together with open registration in Phase 3 (the flag becomes a meaningful filter only when the analyst pool is heterogeneous).

**Capabilities never depend on the trust flag.** Every registered analyst can submit geolocations, post bounties, follow other analysts, and use every feature. The flag, once it lands in Phase 3, is a **visible, filterable status** — not a capability gate.

Smaller than the original draft: confidence levels, co-validation, comments, and reputation systems are dropped. Admin-driven moderation plus the future trust filter cover the quality bar without the operational complexity of UGC-style reputation systems (spam, brigading, DSA notice-and-action surface for every comment).

### Profile & identity
- Bio + external links on the profile (linktree-style: X, Discord, website, GitHub).
- Twitter/X account link on the profile (identity anchor).

### Moderation (lightweight, admin-driven)
- **Report this content** → admin review queue. **No** community vote, **no** reputation impact, **no** thresholding rules.
- Sensitive-content gate UI on geolocation media (compliance, ties to AWS Rekognition + Cloudflare CSAM scanning at upload — see [`next.md`](next.md)).
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

**Goal:** open the platform — anonymous read for everyone, open self-registration for anyone who wants to contribute. Reached in two deliberate stages so the doors open before everything is polished: **3a — open beta**, then **3b — public v1**.

- **Public read access** — anyone can browse the map and geolocation pages without an account.
- **Open registration** — invite codes are retired. Anyone can sign up via the public registration form (CAPTCHA, honeypot, disposable-email blocklist, rate limits — see [`next.md`](next.md) → *M2 — Open beta*). Once registered, every analyst has full write capabilities (submit geolocations, post bounties, follow others).
- **Trusted-contributor flag** ships here — single bit, admin-granted via an opt-in "Request analyst access" form, paired with a required `trust_reason` note explaining the basis (track record, profession, established X handle, etc.). The badge is **visible, clickable, and filterable**: clicking it surfaces the `trust_reason`; filter chips on the map, timeline, search, and bounty index let readers scope to vetted-only. Non-trusted analysts have identical capabilities — the flag is purely a credibility signal, never a gate. See [`next.md`](next.md) → *M2 — Open beta* for scope.
- Public landing page explaining the platform — shipped as the closed-beta vitrine and matured through the launch.

The deliberate asymmetry: **read is open, write is open after registration, the trust flag is a curated quality filter on top.** Quality protection sits at three layers: anti-abuse on registration, content moderation on uploads, and the trust filter for readers.

### Stage 3a — Open beta

Open the doors behind the hard safety + legal stack, with a beta badge still on. Anti-scraping, full Tier 3 + 4 auth hardening, content moderation, the trust-reason field on vetted analysts, and legal pre-flight all gate this stage — you cannot let the public in (or accept public content) without them. See [`next.md`](next.md) → *M2 — Open beta*. The codebase is **already open-source by this point** (see *Openness & transparency*).

### Stage 3b — Public v1

The open beta proven out and finished into a full release: real catalog density, search and social depth, cost tuning, and the closed-beta framing removed. See [`next.md`](next.md) → *M3 — Public v1*.

---

## Phase 4 — Long-term enrichment

**Goal:** deepen the value of every geolocation over time.

Reputation, comments, co-validation, and community-driven moderation were in earlier drafts. Explicitly dropped — see Phase 2.

Open candidates, prioritised later based on real usage:

- Automated source archival (Wayback Machine / archive.today) for every submission, so the platform's evidence promise stays honoured even when X rotates URLs.
- OCR on uploaded media to make captions and signage searchable.
- Related-events suggestions on a geolocation page.
- Translation of proof text between major languages.
- Public read-only API (rate-limited).
- Native mobile companion app.

---

## Openness & transparency (cross-cutting)

Not a phase — a commitment that runs across all of them, and the deliberate answer to a community that is skeptical of closed, unknown tools. Two concrete moves:

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** The codebase ships open ahead of the Phase 3b full release — and, because it's the cheapest and loudest rebuttal to the "closed-source / vibe-coded" objection, as early as the contributor-surface + git-history identity scrub allow (tracked as [`next.md`](next.md) → *M1 — Open source launch*, paired with the closed-beta widening). **Nothing is proprietary.** The monetization layer on the maintainer's hosted instance (`vidit.app`) is **API rate limits + a small set of paid-only endpoints** (saved-search alert webhooks, larger exports) — the unit of sale is throughput against the hosted infrastructure, not feature access. Self-hosters get the full feature set with no rate-limit enforcement. AGPL is the right fit: it keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing view of these milestones — what's shipped, what's next, when open registration and open source land — already ships on the public landing and stays current. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source; the public page is the honest, simplified projection.

The throughline across milestones is **progressive openness**: open the source + restart cold reach in a coordinated launch (M1 — the vitrine + demo video already ship, so the GitHub flip + pinned tweet + cold-reach DMs fire in the same window), open the doors (M2 open beta), then finish it (M3 v1). Each step is the next trust signal to a community where reach is the real bottleneck.

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
