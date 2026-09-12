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

## v0.6: Phone-ready

Analysts live on X and Discord, so a Vidit link travels as a post or a channel message and is opened on a phone far more often than at a desk. The reader who lands on a geolocation from a feed is the platform's widest audience, and they arrive on a 375px screen.

The audit puts the problem in the shell rather than in the content. The three surfaces already handled at 375px (the profile, the event detail page, the shared page chrome) sit inside a frame that was never designed below `sm`: a fixed 56px rail on every route, form fields that make iOS zoom the page on focus, a submit form whose coordinate inputs leave 31px of typing room at 375px and 4px at 320px, embedded maps that swallow the page scroll, and the map page's own panels running off the viewport.

This version makes four golden paths work end to end on a 375px phone, with 320px as the floor: open a shared link, read the geolocation and follow the analyst; browse and filter the map; submit a geolocation from the phone, through both the single form and the X-post import; sign in and manage the account. It ships with a narrow-viewport test floor so the paths stay fixed. It is not a native app: that stays in *Future considerations*.

Work breakdown: [`next.md`](next.md) → *v0.6*.

## v0.6.5: Collections

Analysts already produce this shape of work outside Vidit: a thread grouping several sites around one place (a spatial dossier, e.g. a nuclear plant), or a sequence of strikes over days (an operation reconstruction), published as an X thread or a PDF dossier because Vidit has the pin and the conflict referential and nothing between them.

A collection is a named, curated set of one analyst's own events, personal only: one owner, shown on the owner's public profile. Items order automatically (event date, then creation), the title is the only free-text field, and a collection carries no description and no manual ordering, keeping it a set of facts rather than a narrative. Collaborative and organization-owned collections wait for v0.7.

Work breakdown: [`next.md`](next.md) → *v0.6.5*.

## v0.7: Collaboration & reviews

Two phases: **A**, the substrate (the interaction layer between analysts, plus edit history on a published geolocation), and **B**, the visible layer it carries (organizations and reviews).

Phase A is a notifications feed, shared credit on an event (multiple geolocators), geolocation edit history (an analyst edits a published geolocation while every prior version is kept and visible, because input errors happen and a correction must not silently rewrite the record: an edit creates a version, not an overwrite), and the request board as a collaborative queue (triage, fulfillment notifications).

Phase B makes organizations a first-class entity: a verified collective with members and roles, carrying its own public profile. On top of them, a review layer whose shipped gesture is a single approve: an analyst approves a published geolocation at a specific version, an organization places its approval on a geolocation through its authorized members with the acting member recorded, and anyone can request an approval from an analyst or an organization. An approval covers only the version it was placed on: a new version renders without approvals until it is approved again, prior approvals stay readable in the version history, and each reviewer is notified to re-approve, which is why the versions and notifications of phase A come first.

Reviews are an independent attestation layer: several analysts or organizations can review the same geolocation, they may disagree, and a review never changes the event's status.

Work breakdown: [`next.md`](next.md) → *v0.7*.

## v0.8: Moderation

The moderation pipeline, built as product one version ahead of its legal formalization: an in-product report mechanism feeding an admin moderation queue, machine scanning of uploads (AWS Rekognition, CSAM, metadata stripping), and a written public content policy. Sequenced before open write so the tooling is proven while contributors are still invite-curated.

Work breakdown: [`next.md`](next.md) → *v0.8*.

## v0.9: Search & discovery

The corpus becomes smarter than the sum of its pins: events that carry several subject points, search that reaches proof bodies and source URLs, related-event discovery.

Work breakdown: [`next.md`](next.md) → *v0.9*.

## v0.10: Recognition

The recognition layer: community credits, achievement badges, activity on the profile, and leaderboards. Strictly separate from the quality model (see *Future considerations → Trust + governance*): recognition never gates or ranks content.

Work breakdown: [`next.md`](next.md) → *v0.10*.

## v1.0: Public v1

Open write and the public launch. Self-registration opens and the invite-code gate retires; the threat model widens to account-farmers and unknown uploaded content, absorbed by the layers built in v0.7 to v0.10 plus a registration anti-abuse stack (CAPTCHA, honeypot, disposable-email blocklist, rate limits, account lockout), auth hardening, and self-serve handle verification (verify-by-post, with a claim/dispute path), since open registration removes the admin touchpoint that binds a handle today. The legal foundation lands (legal entity, terms of service, DSA compliance, DPA agreements, professional insurance), plus map density, cost tuning, and the beta framing removed.

Work breakdown: [`next.md`](next.md) → *v1.0*.

---

## Future considerations

Long-term items deferred for cost, scale, philosophical fit, or because the current mechanism is sufficient. None are "never"; each could be revisited as the platform grows. Today's objection is paired with what would put it back on the table.

### Enrichment

- **OCR on uploaded media** to make captions and signage searchable. Today: full-text search covers titles, bios, request descriptions. Revisit when analysts ask for image-content search.
- **Translation of proof text** between major languages. Revisit when the non-English contributor base grows.
- **Public read-only API** (rate-limited). Revisit on integration demand from other tools or the press.
- **Native mobile companion app.** Today: the web app is the phone client, and v0.6 makes the golden paths work on a 375px screen. Revisit when a substantial mobile-only contributor segment emerges.
- **Bulk import / external-source ingestion at runtime.** Today: manual per-geolocation submission is the only ingestion path; the catalog is small enough that this fits. Revisit when a recurring corpus (e.g. Bellingcat archives) warrants productionised ingestion.

### Trust + governance

- **Confidence levels per submission** (low/medium/high). Today: a platform-computed score adds noise without clear product value. Per-event attestation lives in the review layer (v0.7), which names the reviewers rather than computing a level, so a reader weighs named attestations instead of a number. Revisit when the catalog grows large enough that named attestation under-discriminates.
- **Reputation system per scope/conflict.** Today: gameable (Goodhart); per-event attestation plus moderation is the quality model. Reconsider only with a concrete anti-gaming design.
- **Community-driven moderation governance.** Today: community is too small for democracy; admin-driven is faster and cleaner. Revisit when contributor count outgrows what a small admin team can review.
- **Comments / discussion threads** on geolocations. Today: high abuse surface, large DSA UGC moderation burden, low marginal value over X/Discord. Reconsider only with a design that closes the abuse + DSA cost gap.
- **Request coordination at scale.** Today: a request is picked up by geolocating it, and duplicate effort is cheap at beta headcount. The passive "I'm working on this" badge was tried and removed (#256): a signal with no commitment discourages others without guaranteeing work. Reconsider when duplicate geolocation effort shows up in practice, and with commitment semantics: an expiring claim that auto-releases without a publication, or partial proof on the request as the visible, verifiable signal of effort.

---

## Openness & transparency

- **100% open source under [AGPL-3.0](../LICENSE), before v1.** Nothing is proprietary. Nothing on the maintainer's hosted instance (`vidit.app`) is paid today; if monetization ever lands there, the intended shape is API rate limits + paid-only endpoints aimed at consumers of the community's work (saved-search alert webhooks, larger exports), never at analysts. AGPL keeps any hosted fork open while letting anyone run their own instance.
- **Public roadmap.** A reader-facing projection of these milestones ships on the public landing. The internal `roadmap.md` / `next.md` / `CHANGELOG.md` are the source.
