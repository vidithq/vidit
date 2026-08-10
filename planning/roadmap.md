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

## v0.5: Analyst portfolio

The v0.4 on-ramp moves an analyst's published work in; v0.5 makes that body of work a first-class object: a public profile that stands as a portfolio (insights, a personal map, a share affordance), link previews that render the work wherever a profile or event URL lands, a batch completion flow so publishing an import costs one decision rather than one form per draft, a mobile pass on the surfaces those links land on, and automated archival of source links at event creation, drafts included, so the work outlives its tweets. Read stays open (since v0.4), write stays invite-gated, and the anti-scraping floor that public read earns lands here.

Work breakdown: [`next.md`](next.md) → *v0.5*.

## v0.6: Collaboration & reviews

Two phases: **A**, the substrate (the interaction layer between analysts, plus edit history on a published geolocation), and **B**, the visible layer it carries (organizations and reviews).

Phase A is a notifications feed, shared credit on an event (multiple geolocators), geolocation edit history (an analyst edits a published geolocation while every prior version is kept and visible, because input errors happen and a correction must not silently rewrite the record: an edit creates a revision, not an overwrite), and the request board as a collaborative queue (triage, fulfillment notifications).

Phase B makes organizations a first-class entity: a verified collective with members and roles, carrying its own public profile. On top of them, a review layer whose shipped gesture is a single approve: an analyst approves a published geolocation at a specific revision, an organization places its approval on a geolocation through its authorized members with the acting member recorded, and anyone can request an approval from an analyst or an organization. An approval covers only the revision it was placed on: a new revision renders without approvals until it is approved again, prior approvals stay readable in the revision history, and each reviewer is notified to re-approve, which is why the revisions and notifications of phase A come first.

Reviews are an independent attestation layer: several analysts or organizations can review the same geolocation, they may disagree, and a review never changes the event's status or the author's trusted flag.

Work breakdown: [`next.md`](next.md) → *v0.6*.

## v0.7: Moderation

The moderation pipeline, built as product one version ahead of its legal formalization: an in-product report mechanism feeding an admin moderation queue, machine scanning of uploads (AWS Rekognition, CSAM, metadata stripping), and a written public content policy. Sequenced before open write so the tooling is proven while contributors are still invite-curated.

Work breakdown: [`next.md`](next.md) → *v0.7*.

## v0.8: Search & discovery

The corpus becomes smarter than the sum of its pins: events that carry several subject points, search that reaches proof bodies and source URLs, related-event discovery.

Work breakdown: [`next.md`](next.md) → *v0.8*.

## v0.9: Recognition

The recognition layer: community credits, achievement badges, activity on the profile, and leaderboards. Strictly separate from trust (see *Future considerations → Trust + governance*): recognition never feeds the trusted-contributor flag.

Work breakdown: [`next.md`](next.md) → *v0.9*.

## v1.0: Public v1

Open write and the public launch. Self-registration opens and the invite-code gate retires; the threat model widens to account-farmers and unknown uploaded content, absorbed by the layers built in v0.6-v0.9 plus a registration anti-abuse stack (CAPTCHA, honeypot, disposable-email blocklist, rate limits, account lockout), auth hardening, and self-serve handle verification (verify-by-post, with a claim/dispute path), since open registration removes the admin touchpoint that binds a handle today. The trusted-contributor flag becomes a reader-facing filter across map / timeline / search. The legal foundation lands (legal entity, CGU, DSA compliance, DPA agreements, professional insurance), plus map density, cost tuning, and the closed-beta framing removed.

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

- **Confidence levels per submission** (low/medium/high). Today: the trust filter on the author lets readers scope to known-credible submissions; per-action scoring adds noise without clear product value. Per-event attestation lives in the review layer (v0.6), which names reviewers rather than computing a level, so what stays deferred here is a platform-computed score on the submission itself. Revisit when the catalog grows large enough that author-level trust under-discriminates.
- **Reputation system per scope/conflict.** Today: gameable (Goodhart); the admin-curated trust flag plus moderation is sufficient. Reconsider only with a concrete anti-gaming design.
- **Community-driven moderation governance.** Today: community is too small for democracy; admin-driven is faster and cleaner. Revisit when contributor count outgrows what a small admin team can review.
- **Comments / discussion threads** on geolocations. Today: high abuse surface, large DSA UGC moderation burden, low marginal value over X/Discord. Reconsider only with a design that closes the abuse + DSA cost gap.

---

## Openness & transparency

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** Nothing is proprietary. Nothing on the maintainer's hosted instance (`vidit.app`) is paid today; if monetization ever lands there, the intended shape is API rate limits + paid-only endpoints aimed at consumers of the community's work (saved-search alert webhooks, larger exports), never at analysts. AGPL keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing projection of these milestones ships on the public landing. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source.
