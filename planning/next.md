# What's next

The rows for the current version and the next one, organized by the milestones in [`roadmap.md`](roadmap.md). Every row's full detail, later versions, the refactors and the unscheduled candidates live in [`backlog.md`](backlog.md). A row's last cell is one sentence stating the outcome, with a link to its detail (the rule lives in [`CONTRIBUTING.md`](../CONTRIBUTING.md#doc-sync-rule)).

Within each version, rows carry a priority:

- **P0**: hard blocker; the version doesn't ship without it.
- **P1**: strongly recommended; lands inside the version if there's time.
- **P2**: nice-to-have; can slip without embarrassment.
- **P3**: low priority; picked up when it is cheap or unblocks something else.

---

## v0.6: Phone-ready *(now)*

Strategic context: [`roadmap.md`](roadmap.md) → *v0.6*.

| Pri | Area | Item | Outcome |
|---|---|---|---|
| P2 | Submit | Camera capture on the phone | On a phone, a camera button next to the proof-image and media pickers opens the rear camera through `capture="environment"`, so Android offers it too. [detail](backlog.md#v06-phone-ready) |
| P2 | Map | The zoom control under the detail sheet | Below `sm`, the map's zoom control stays reachable while the detail bottom sheet is open. [detail](backlog.md#v06-phone-ready) |
| P2 | Read | The reading sizes on `/about` | The `/about` body copy and feature-card blurbs get a decided reading size below `sm`, applied in one pass. [detail](backlog.md#v06-phone-ready) |
| P2 | Perf | Weight of the map page on a phone | The map page's weight on a mid-range Android over 4G is measured and recorded in `engineering.md` before any decision on a lighter style or lazy loading. [detail](backlog.md#v06-phone-ready) |

---

## v0.7: Collaboration & reviews

Strategic context: [`roadmap.md`](roadmap.md) → *v0.7*. P2 and P3 rows of this version wait in [`backlog.md`](backlog.md#v07-collaboration--reviews).

| Pri | Area | Item | Outcome |
|---|---|---|---|
| P0 | Notifications | A: `/notifications` feed, sidebar unread binding, and the fulfilled-request event | A `/notifications` feed with a per-user last-read marker drives the sidebar unread dot, and its first event tells an analyst that their request was fulfilled. [detail](backlog.md#v07-collaboration--reviews) |
| P0 | Collaboration | A: Geolocator-addition model + flow | A second analyst joins an event as a geolocator through one decided flow (request-and-accept by default) that writes to `event_geolocators`. [detail](backlog.md#v07-collaboration--reviews) |
| P0 | Collaboration | A: Re-home attribution reads onto `event_geolocators` | The profile count and list, the author filter and search-by-author read `event_geolocators` membership instead of `owner_id`, inside the published-only filter. [detail](backlog.md#v07-collaboration--reviews) |
| P0 | Organizations | B: Organizations: entity with verified creation, two-role membership, and who may place the org approval | An admin creates an organization anchored on a verified `x_handle`, members join by org-admin invitation in one of two roles, and a public page lists its members and reviews. [detail](backlog.md#v07-collaboration--reviews) |
| P0 | Reviews | B: Review model bound to a revision | A review is a dated approve bound to one revision, placed by a user or an organization, and revoked only with a reason that stays readable in history. [detail](backlog.md#v07-collaboration--reviews) |
| P0 | Reviews | B: Review write flow, event-page render, and the re-review loop on a new revision | An approve action on the event page shows reviews only on the revision they cover, and a new revision notifies the prior reviewers so they re-approve in one action. [detail](backlog.md#v07-collaboration--reviews) |
| P1 | Ops | A failed share-card read raises a signal | A failed share-card read sends a sampled Sentry message, and an uptime monitor fails when an event card serves the fallback image. [detail](backlog.md#v07-collaboration--reviews) |
| P1 | UX | A: Post-confirm recap in the detection queue | A confirmation pass in the detection queue ends on a recap that links each geolocation it just published. [detail](backlog.md#v07-collaboration--reviews) |
| P1 | UX | A: Decide where a clickable analyst handle leads: the profile portfolio or `/search?author=` | Every clickable analyst handle leads to one decided destination, the profile portfolio or `/search?author=`. [detail](backlog.md#v07-collaboration--reviews) |
| P1 | Reviews | B: Review requests | An analyst asks a named analyst or organization to approve an event, the request reaches the target's notifications, and open requests show on the event page. [detail](backlog.md#v07-collaboration--reviews) |
