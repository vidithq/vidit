# Roadmap

> Become the home of the OSINT/GEOINT community.

What's currently open lives in [`next.md`](next.md). What's already shipped lives in [`CHANGELOG.md`](../CHANGELOG.md).

---

## Vision

### The problem

OSINT/GEOINT analysts who geolocate armed-conflict events have no dedicated, open, professional tool to archive and share their work. Geolocations are posted to Twitter, with no structured format and no place to centralize them. The few dedicated tools that exist tend to be closed to part of the community and ship with dated interfaces.

### The solution

A web platform where analysts reference, archive, and visualize geolocations of armed-conflict events.

### Primary persona — the OSINT/GEOINT analyst

An enthusiast (amateur or professional) who collects media (images, videos) from armed conflicts via open sources: Twitter/X, Telegram, Signal, satellite-imagery providers. They use visual cues in the media to pin down where it was filmed. Mostly active on Twitter/X and Discord; the community is international, English-speaking, and concentrated around major conflicts (Ukraine, Middle East, sub-Saharan Africa).

They need a single place to centralize geolocations, a structured format to present proof, an interactive map to visualize all events, and a tool whose quality matches the seriousness of the work — good enough to recommend to their community.

### Guiding principles

1. **Openness** — accessible to as many people as possible, no artificial barriers.
2. **Simplicity** — posting a geolocation takes less than two minutes.
3. **Quality** — the design and experience match the seriousness of the community.
4. **Neutrality** — the platform references geolocated facts, not political stances.

---

## What's shipped

**Closed-beta MVP.** Invite-only auth, interactive map with conflict/tag filters, geolocation submission (coordinates + source URL + media + Tiptap proof + tags), geolocation detail pages, analyst profiles.

**Curated-platform consolidation.** Profile expansion (bio, external links, X identity anchor), admin panel (invite minting, soft/hard delete, trusted-contributor flag, demo seeding, reaper jobs), social graph (follow, timeline feed), full-text search across geolocations / analysts / bounties, bounties (open requests for geolocations to fulfil), UX polish.

Per-PR detail in [`CHANGELOG.md`](../CHANGELOG.md).

---

## v0.3 — Open source launch

A single coordinated event that retires the "closed-source / unknown / vibe-coded" objection and widens the closed-beta analyst pool beyond the early testers. The AGPL-3.0 flip on the repo and the pinned X tweet on [`@vidithq`](https://x.com/vidithq) fire in the same window. This operationalizes the standing AGPL commitment (see *Openness & transparency* below) and opens the *codebase* — not the doors. Independent of the safety stack.

Work breakdown: [`next.md`](next.md) → *v0.3*.

## v0.4 — Curated onboarding (read-only)

Analysts already do the geolocation work and post it to X; what blocks adoption is the time it would cost *them* to re-enter it into Vidit by hand — coordinates, source, media, proof, tags, one geolocation at a time. This tier removes that cost: an analyst imports their published history in one step and keeps it current by tagging a Vidit bot, so joining costs them a yes, not hours of re-entering work they've already done.

The shape inverts the closed beta: **read opens to everyone; write stays gated.** The curated on-ramp becomes a second path to a writing account alongside the existing invite-gated registration. What stays deferred to v0.5 is *open* self-registration (sign up with no invite) and the open-write stack it needs: upload moderation, CSAM scanning, registration anti-abuse.

The decisions that bound it:

- **Two self-serve channels, one shared core.** The analyst **uploads their official X archive** (the "Download your data" export — full history, no API, no cap) for a one-time backfill, and **tags a Vidit bot** on each new geolocation tweet for ongoing sync. Both feed one extraction core; re-uploading a fresh archive is a free catch-up.
- **Consent is the action.** The upload and the tag *are* the consent — in-product, self-serve, scoped to the analyst's own posts. Nothing is fetched, processed, or published for anyone who hasn't acted; there is no out-of-band ask.
- **Attribution is provisional; ownership is not verified in v0.4.** An import attributes work to a `@handle` without proving the uploader controls it — X's OAuth consent is too broad for a privacy-conscious audience and X offers no lighter identity integration (no OIDC; OAuth 1.0a is worse). The exposure is bounded: everything lands `detected` (draft, clearly marked), nothing is publicly vouched without a later validate, and the beta stays invite-gated. Handle-ownership proof + a claim/dispute pipeline move to v0.5.
- **Detection is deterministic.** A parseable coordinate marks a geolocation tweet; there is no LLM classifier. The work is robust coordinate and media extraction, not training a model.
- **Machine output is provisional but public.** Imported and bot-ingested geolocations land `detected` and appear on **every** public surface (map, search, timeline, profile), **always clearly marked**; the owner reviews and **validates** them, which removes the marker and freezes the row. A direct submission or a bounty fulfilment is born `validated`.

This pulls anonymous read forward from v0.5 and adds the onboarding machinery: the extraction core, the archive intake, the `detected → validated` review flow, and an author identity decoupled from the auth account (shipped). The bot replies in-thread with dedup and coordinate-vs-image warnings, and a value layer — image-coordinate cross-checks and near-duplicate media matching — is what makes the import worth the analyst's while. Going public is gated on a legal review — a reduced surface, since only the analyst's own consented work is ever processed.

Work breakdown: [`next.md`](next.md) → *v0.4*.

## v0.5 — Open beta

Open self-registration; the invite-code gate retires. Anonymous read lands in v0.4 — v0.5 widens the gate to **open write**: anyone can register and submit, not just claim a seeded profile or enter on an invite. The threat model widens to account-farmers and unknown uploaded content.

Three layers protect quality:

- **Anti-abuse on registration** — CAPTCHA, honeypot, disposable-email blocklist, rate limits.
- **Content moderation on uploads** — AWS Rekognition + CSAM scanning.
- **Trusted-contributor flag** as a reader-facing filter — single bit, admin-granted with a required `trust_reason`, visible and filterable across map / timeline / search / bounty index.

Asymmetric design: read is open, write is open after registration, the trust mark is a curated quality filter on top.

Plus **handle-ownership verification + a claim/dispute pipeline**, deferred from v0.4: before content is publicly attributed to a real analyst, they must prove control of the `@handle` — likely **verify-by-post** (a one-time code in a public tweet, read back via the free syndication path; Keybase-style, zero OAuth consent), since X's OAuth screen proved too broad for the audience. A dispute path covers contested attribution (e.g. a geolocation stolen and imported under the wrong handle).

Plus the legal foundation (DSA compliance, DPA agreements, professional insurance) the public-facing entity needs.

Work breakdown: [`next.md`](next.md) → *v0.5*.

## v1.0 — Public v1

Open beta hardened: catalog density, search and social depth, cost tuning, closed-beta framing removed.

Work breakdown: [`next.md`](next.md) → *v1.0*.

---

## Future considerations

Long-term items deferred for cost, scale, philosophical fit, or because the current mechanism is sufficient. None are "never" — each could be revisited as the platform grows. Today's objection is paired with what would put it back on the table.

### Enrichment

- **Automated source archival** (Wayback Machine / archive.today) on every submission, so links survive X URL rotation. Today: manual save when an analyst remembers. Revisit when link rot becomes a felt problem in the catalog.
- **OCR on uploaded media** to make captions and signage searchable. Today: full-text search covers titles, bios, bounty descriptions. Revisit when analysts ask for image-content search.
- **Related-events suggestions** on a geolocation page. Revisit when catalog density makes manual discovery slow.
- **Translation of proof text** between major languages. Revisit when the non-English contributor base grows.
- **Public read-only API** (rate-limited). Revisit on integration demand from other tools or the press.
- **Native mobile companion app.** Revisit when a substantial mobile-only contributor segment emerges.
- **Bulk import / external-source ingestion at runtime.** Today: manual per-geolocation submission is the only ingestion path; the catalog is small enough that this fits. Revisit when a recurring corpus (e.g. Bellingcat archives) warrants productionised ingestion.

### Trust + governance

- **Confidence levels per submission** (low/medium/high). Today: the trust filter on the author lets readers scope to known-credible submissions; per-action scoring adds noise without clear product value. Revisit when the catalog grows large enough that author-level trust under-discriminates.
- **Co-validation by other analysts** (a second analyst endorses a geolocation). Same logic and revisit trigger as confidence levels.
- **Reputation system per scope/conflict.** Today: gameable (Goodhart) — the admin-curated trust flag plus moderation is sufficient. Reconsider only with a concrete anti-gaming design.
- **Community-driven moderation governance.** Today: community is too small for democracy — admin-driven is faster and cleaner. Revisit when contributor count outgrows what a small admin team can review.
- **Comments / discussion threads** on geolocations. Today: high abuse surface, large DSA UGC moderation burden, low marginal value over X/Discord. Reconsider only with a design that closes the abuse + DSA cost gap.

---

## Openness & transparency

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** Nothing is proprietary. Monetization on the maintainer's hosted instance (`vidit.app`) is API rate limits + paid-only endpoints (saved-search alert webhooks, larger exports). AGPL keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing projection of these milestones ships on the public landing. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source.
