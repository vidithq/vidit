# Roadmap

> Become the home of the OSINT/GEOINT community.

What's currently open lives in [`next.md`](next.md). What's already shipped lives in [`CHANGELOG.md`](../CHANGELOG.md).

---

## Vision

### The problem

OSINT/GEOINT analysts who geolocate armed-conflict events have no dedicated, open, professional tool to archive and share their work. Geolocations are posted to Twitter, with no structured format and no place to centralize them. The few dedicated tools that exist tend to be closed to part of the community and ship with dated interfaces.

### The solution

A web platform where analysts reference, archive, and visualize geolocations of armed-conflict events.

### Primary persona: the OSINT/GEOINT analyst

An enthusiast (amateur or professional) who collects media (images, videos) from armed conflicts via open sources: Twitter/X, Telegram, Signal, satellite-imagery providers. They use visual cues in the media to pin down where it was filmed. Mostly active on Twitter/X and Discord; the community is international, English-speaking, and concentrated around major conflicts (Ukraine, Middle East, sub-Saharan Africa).

They need a single place to centralize geolocations, a structured format to present proof, an interactive map to visualize all events, and a tool whose quality matches the seriousness of the work, good enough to recommend to their community.

### Guiding principles

1. **Openness**: accessible to as many people as possible, no artificial barriers.
2. **Simplicity**: posting a geolocation takes less than two minutes.
3. **Quality**: the design and experience match the seriousness of the community.
4. **Neutrality**: the platform references geolocated facts, not political stances.

---

## What's shipped

**Closed-beta MVP.** Invite-only auth, interactive map with conflict/tag filters, geolocation submission (coordinates + source URL + media + Tiptap proof + tags), geolocation detail pages, analyst profiles.

**Curated-platform consolidation.** Profile expansion (bio, external links, X identity anchor), admin panel (invite minting, soft/hard delete, trusted-contributor flag, demo seeding, reaper jobs), social graph (follow, timeline feed), full-text search across geolocations / analysts / requests, requests (open requests for geolocations to fulfil), UX polish.

Per-PR detail in [`CHANGELOG.md`](../CHANGELOG.md).

---

## v0.3: Open source launch

A single coordinated event that retires the "closed-source / unknown / vibe-coded" objection and widens the closed-beta analyst pool beyond the early testers. The AGPL-3.0 flip on the repo and the pinned X tweet on [`@vidithq`](https://x.com/vidithq) fire in the same window. This operationalizes the standing AGPL commitment (see *Openness & transparency* below) and opens the *codebase*, not the doors. Independent of the safety stack.

Work breakdown: [`next.md`](next.md) → *v0.3*.

## v0.4: Curated onboarding (read-only)

Analysts already do the geolocation work and post it to X; what blocks adoption is the time it would cost *them* to re-enter it into Vidit by hand: coordinates, source, media, proof, tags, one geolocation at a time. This tier removes that cost: an analyst imports their published history in one step and keeps it current by tagging a Vidit bot, so joining costs them a yes, not hours of re-entering work they've already done.

The shape inverts the closed beta: **read opens to everyone; write stays gated.** The curated on-ramp becomes a second path to a writing account alongside the existing invite-gated registration. What stays deferred is *open* self-registration (sign up with no invite, v1.0) and the open-write stack it needs: upload moderation and CSAM scanning (v0.7), registration anti-abuse (v1.0).

The decisions that bound it:

- **Two self-serve channels, one shared core.** The analyst **uploads their official X archive** (the "Download your data" export: full history, no API, no cap) for a one-time backfill, and **tags a Vidit bot** on each new geolocation tweet for ongoing sync. Both feed one extraction core; re-uploading a fresh archive is a free catch-up.
- **Consent is the action.** The upload and the tag *are* the consent: in-product, self-serve, scoped to the analyst's own posts. Nothing is fetched, processed, or published for anyone who hasn't acted; there is no out-of-band ask.
- **Attribution is provisional; ownership is not verified in v0.4.** An import attributes work to a `@handle` without proving the uploader controls it: X's OAuth consent is too broad for a privacy-conscious audience and X offers no lighter identity integration (no OIDC; OAuth 1.0a is worse). The exposure is bounded: everything lands `detected` (draft, clearly marked), nothing is publicly vouched without a later submit, and the beta stays invite-gated. Handle-ownership proof + a claim/dispute pipeline move to v0.6.
- **Detection is deterministic.** A parseable coordinate marks a geolocation tweet; there is no LLM classifier. The work is robust coordinate and media extraction, not training a model.
- **Machine output is provisional but public.** Imported and bot-ingested geolocations land `detected` and appear on **every** public surface (map, search, timeline, profile), **always clearly marked**; the owner reviews and **submits** them, which removes the marker and freezes the row. A direct submission or a request fulfilment is born `geolocated`.

This pulls anonymous read forward from the later open-write plan and adds the onboarding machinery: the extraction core, the archive intake, the `detected → submitted` submit flow, and an author identity decoupled from the auth account (shipped). The bot replies in-thread with dedup and coordinate-vs-image warnings, and a value layer (image-coordinate cross-checks and near-duplicate media matching) is what makes the import worth the analyst's while. Going public is gated on a legal review, a reduced surface since only the analyst's own consented work is ever processed.

Work breakdown: [`next.md`](next.md) → *v0.4*.

## v0.5: Analyst portfolio

The v0.4 on-ramp moves an analyst's published work in; v0.5 makes that body of work a first-class object: a public profile that stands as a portfolio (insights, a personal map, a share affordance), link previews that render the work wherever a profile or event URL lands, a batch completion flow so publishing an import costs one decision rather than one form per draft, verification returned in the bot's own replies (coordinate-vs-image cross-check, near-duplicate detection across analysts), corroboration between analysts on a published geolocation, and automated archival of source links so the work outlives its tweets. Read stays open (since v0.4), write stays invite-gated.

Work breakdown: [`next.md`](next.md) → *v0.5*.

## v0.6: Collaboration

The interaction layer between analysts: a notifications feed, shared credit on an event (multiple geolocators), self-serve handle-ownership verification with a claim/dispute path for contested attribution (**verify-by-post**: a one-time code in a public tweet, read back via the free syndication path; Keybase-style, zero OAuth consent, since X's OAuth screen proved too broad for the audience), follower lists, and the request board as a collaborative queue (triage, fulfillment notifications).

Work breakdown: [`next.md`](next.md) → *v0.6*.

## v0.7: Moderation

The moderation pipeline, built as product one version ahead of its legal formalization: an in-product report mechanism feeding an admin moderation queue, machine scanning of uploads (AWS Rekognition, CSAM, metadata stripping), and a written public content policy. Sequenced before open write so the tooling is proven while contributors are still invite-curated.

Work breakdown: [`next.md`](next.md) → *v0.7*.

## v0.8: Catalog intelligence

The corpus becomes smarter than the sum of its pins: events that carry several subject points, search that reaches proof bodies and source URLs, related-event discovery.

Work breakdown: [`next.md`](next.md) → *v0.8*.

## v0.9: Recognition

The recognition layer: community credits, achievement badges, activity on the profile, leaderboards, and team / collective profiles with shared credit. Strictly separate from trust (see *Future considerations → Trust + governance*): recognition never feeds the trusted-contributor flag.

Work breakdown: [`next.md`](next.md) → *v0.9*.

## v1.0: Public v1

Open write and the public launch. Self-registration opens and the invite-code gate retires; the threat model widens to account-farmers and unknown uploaded content, absorbed by the layers built in v0.6-v0.9 plus a registration anti-abuse stack (CAPTCHA, honeypot, disposable-email blocklist, rate limits, account lockout) and auth hardening. The trusted-contributor flag becomes a reader-facing filter across map / timeline / search. The legal foundation lands (legal entity, CGU, DSA compliance, DPA agreements, professional insurance), plus catalog density, cost tuning, and the closed-beta framing removed.

Work breakdown: [`next.md`](next.md) → *v1.0*.

---

## Future considerations

Long-term items deferred for cost, scale, philosophical fit, or because the current mechanism is sufficient. None are "never"; each could be revisited as the platform grows. Today's objection is paired with what would put it back on the table.

### Enrichment

- **OCR on uploaded media** to make captions and signage searchable. Today: full-text search covers titles, bios, request descriptions. Revisit when analysts ask for image-content search.
- **Translation of proof text** between major languages. Revisit when the non-English contributor base grows.
- **Public read-only API** (rate-limited). Revisit on integration demand from other tools or the press.
- **Native mobile companion app.** Revisit when a substantial mobile-only contributor segment emerges.
- **Bulk import / external-source ingestion at runtime.** Today: manual per-geolocation submission is the only ingestion path; the catalog is small enough that this fits. Revisit when a recurring corpus (e.g. Bellingcat archives) warrants productionised ingestion.

### Trust + governance

- **Confidence levels per submission** (low/medium/high). Today: the trust filter on the author lets readers scope to known-credible submissions; per-action scoring adds noise without clear product value. Revisit when the catalog grows large enough that author-level trust under-discriminates.
- **Reputation system per scope/conflict.** Today: gameable (Goodhart); the admin-curated trust flag plus moderation is sufficient. Reconsider only with a concrete anti-gaming design.
- **Community-driven moderation governance.** Today: community is too small for democracy; admin-driven is faster and cleaner. Revisit when contributor count outgrows what a small admin team can review.
- **Comments / discussion threads** on geolocations. Today: high abuse surface, large DSA UGC moderation burden, low marginal value over X/Discord. Reconsider only with a design that closes the abuse + DSA cost gap.

---

## Openness & transparency

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** Nothing is proprietary. Nothing on the maintainer's hosted instance (`vidit.app`) is paid today; if monetization ever lands there, the intended shape is API rate limits + paid-only endpoints aimed at consumers of the community's work (saved-search alert webhooks, larger exports), never at analysts. AGPL keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing projection of these milestones ships on the public landing. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source.
