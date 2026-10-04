# Changelog

What shipped in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- The README, CONTRIBUTING, issue templates, planning files and promo pipeline guide are deduplicated and checked against the code ([#373](https://github.com/vidithq/vidit/pull/373)).
- Dependabot waits a cooldown before opening a version-update PR (7 days for a major, 3 for a minor, 1 for a patch); security updates are unaffected ([#387](https://github.com/vidithq/vidit/pull/387)).
- The events service is a package with one module per write verb; callers import it from the same place ([#371](https://github.com/vidithq/vidit/pull/371)).

### Fixed

- Password forms stop input at 72 bytes and explain the limit in plain words, and `make install` installs the backend test tools so `make test` runs on a fresh machine ([#529](https://github.com/vidithq/vidit/pull/529)).
- Local storage refuses a key that escapes its root on delete too, which clears the CodeQL path-injection alerts ([#525](https://github.com/vidithq/vidit/pull/525)).
- The narrow-viewport smoke job no longer fails at random on the collection pages ([#374](https://github.com/vidithq/vidit/pull/374)).
- The map detail panel shows only the selected event, and a failed load shows the error with a Retry control ([#357](https://github.com/vidithq/vidit/pull/357)).
- A password over 72 bytes gets a validation error instead of a server error ([#358](https://github.com/vidithq/vidit/pull/358)).
- An upload no longer stalls the whole API, and a lock wait over 5 seconds answers 409 ([#359](https://github.com/vidithq/vidit/pull/359)).
- Image uploads decode under bounded memory, and profile pictures are capped at 25 megapixels ([#360](https://github.com/vidithq/vidit/pull/360)).
- Backend logs print app records one line each with a request id, and every response carries `X-Request-ID` ([#361](https://github.com/vidithq/vidit/pull/361)).

## v0.6.5, 2026-09-17

### Added

- A shared collection link unfurls as its own share card.
- A collection shows the tags of the events it holds.
- The collection page has a Share on X control.

### Changed

- A collection's description is written in the proof editor.

### Fixed

- A collection of video clips no longer shows broken tiles.
- Closed events no longer count in a profile's figures.
- A profile share card draws the avatar again.

## v0.6.4, 2026-09-15

### Added

- Collections: analysts group events into a collection, with a collection page, a profile section and an add-to-collection panel ([#343](https://github.com/vidithq/vidit/pull/343)).
- Collections appear as a search result group ([#343](https://github.com/vidithq/vidit/pull/343)).
- A collection page steps through its events and shows a Description card ([#343](https://github.com/vidithq/vidit/pull/343)).
- Creating and editing a collection use pages of their own, with a search to pick its events ([#343](https://github.com/vidithq/vidit/pull/343)).
- Anyone can report a collection, its owner can delete it from its page, and an admin can take it down ([#343](https://github.com/vidithq/vidit/pull/343)).

## v0.6.3, 2026-09-15

### Added

- Tagging @ViditBot on a mirror post without coordinates opens a request ([#342](https://github.com/vidithq/vidit/pull/342)).
- An open request can be edited by its owner and is listed on their profile ([#342](https://github.com/vidithq/vidit/pull/342)).

### Changed

- The import engine's warning and refusal messages say what to do next ([#342](https://github.com/vidithq/vidit/pull/342)).

### Fixed

- A reply that only inherits the tag from its parent post is no longer read as a mention ([#342](https://github.com/vidithq/vidit/pull/342)).

## v0.6.2, 2026-09-11

### Added

- A narrow-viewport test floor runs the four golden paths in Chromium at 375x812 and 320x568 ([#341](https://github.com/vidithq/vidit/pull/341)).

### Fixed

- Form fields render at 16px on a phone, so focusing one no longer zooms the page ([#341](https://github.com/vidithq/vidit/pull/341)).
- At 320px, the coordinate pair stacks, filter tap targets are full size, and the submit path, detail rows, settings, cards and date fields fit ([#341](https://github.com/vidithq/vidit/pull/341)).
- An embedded map no longer traps the page scroll ([#341](https://github.com/vidithq/vidit/pull/341)).
- The phone layout follows the dynamic viewport height and the display cutout, and the media lightbox clears the URL bar ([#341](https://github.com/vidithq/vidit/pull/341)).

## v0.6.1, 2026-09-10

### Fixed

- The admin onboarding table shows last activity instead of the last password login ([#335](https://github.com/vidithq/vidit/pull/335)).

## v0.6.0, 2026-09-10

### Added

- Phone navigation uses a floating chip and a drawer instead of the sidebar rail ([#333](https://github.com/vidithq/vidit/pull/333)).
- The map page on a phone uses a bottom sheet, a bounded filter column and a wider touch target around pins ([#333](https://github.com/vidithq/vidit/pull/333)).
- The segmented control stretches to full width on a phone ([#333](https://github.com/vidithq/vidit/pull/333)).

### Changed

- The roadmap makes v0.6 the phone-ready release and shifts the later milestones by one ([#332](https://github.com/vidithq/vidit/pull/332)).

## v0.5.9, 2026-08-24

### Added

- The admin console has a catalogue feed panel ([#305](https://github.com/vidithq/vidit/pull/305)).
- Admins can hard-delete unused invite codes, and the invite table is easier to read ([#314](https://github.com/vidithq/vidit/pull/314)).

### Changed

- An archived snapshot is checked for where it lives, not for what it captured ([#313](https://github.com/vidithq/vidit/pull/313)).
- Three more archive.today domains and Ghostarchive are accepted as archive providers.

## v0.5.8, 2026-08-20

### Fixed

- A bare `@ViditBot` reply under the analyst's own thread finds the coordinate post above it ([#303](https://github.com/vidithq/vidit/pull/303)).

## v0.5.7, 2026-08-20

### Added

- The v0.5 promo pipelines A and B run on a shared capture harness ([#280](https://github.com/vidithq/vidit/pull/280)).

### Changed

- The profile's Insights tiles open the rows behind them ([#301](https://github.com/vidithq/vidit/pull/301)).
- An owner retracts a published geolocation instead of deleting it, and the owner hard delete is removed.
- A published geolocation's evidence anchor is editable as a new version that records what the claim rested on and keeps the old source file.
- The follow feed shows published work only.
- The landing demo video is click-to-play.
- The bot's reply limits are settings.

## v0.5.6, 2026-08-19

### Added

- Correcting a published geolocation creates a new version instead of rewriting it, and a correction cannot drop below the publish floor.
- An archived copy added to a published record is a version of its own, recorded from the edit form.
- Every version is readable at its own address, the history is paged, and `/events/{id}` stays the canonical address.
- An admin can redact one version while the record still shows it existed, and can read a withheld row's history.
- A proof image that a past version still shows is never deleted.
- One edit form covers both owner edits; a version must change something and may leave the source post time blank.
- An event holds at most 100 versions, and evidence preservation does not count toward the limit.
- Each row is credited to the edit that produced it, and an untouched time input no longer rewrites a value it cannot hold.

### Fixed

- Generated icons ship at every declared size, so Google shows the site icon instead of a generic globe.

## v0.5.5, 2026-08-18

### Changed

- The bot, the paste flow and the archive backfill share one post grammar and answer the same way ([#292](https://github.com/vidithq/vidit/pull/292)).
- Pasting a post creates the detection directly instead of pre-filling a form ([#292](https://github.com/vidithq/vidit/pull/292)).
- One analyst-facing import guide lives at `/import` and states the conditions in one paragraph ([#292](https://github.com/vidithq/vidit/pull/292)).
- A detection says what it still needs, in the bot reply and in the email ([#292](https://github.com/vidithq/vidit/pull/292)).
- A machine detection is identified by its source post, not by that post's URL, so a tagged thread and the archive holding it are one detection ([#292](https://github.com/vidithq/vidit/pull/292)).
- The row a machine creates is called a detection everywhere, and it records which entry produced it ([#292](https://github.com/vidithq/vidit/pull/292)).
- A title line can carry text beyond coordinates and links, and the source and the footage must name the same post.
- A re-import never deletes media the fetch could not reach, and a transient fetch failure is retried.
- Warnings count the detections the pass wrote and read the same wherever they appear.
- The bot answers a tag that updated a detection or that it could not store, and the paste names an unreadable post as the bot does.
- A fresh detection shows on the map immediately, and imported photos are stored in one format.
- An archive import runs under the analyst's linked X handle or not at all.
- Linked accounts show as icon buttons in the profile header, and each must be a valid account handle.

### Removed

- The copy-link control on the public profile header.

## v0.5.4, 2026-08-17

### Security

- A profile picture is uploaded instead of linked from a URL its owner types ([#289](https://github.com/vidithq/vidit/pull/289)).

### Added

- The profile's Insights card shows where an analyst's footage comes from and states which population it describes.
- A public profile lists the work its analyst published, not the drafts they were handed, and `geolocations_count` counts the same work.
- The profile activity chart covers the analyst's whole history and reads as a calendar.

### Changed

- The public profile leads with the work, and its counts become one line of the identity block.
- The archive control opens one provider page instead of two.
- One mark identifies an archived copy everywhere.

## v0.5.3, 2026-08-14

### Fixed

- Tweet import reports the real cause for a post X will not serve: 404 for an age-restricted or withheld post, 503 for throttling ([#266](https://github.com/vidithq/vidit/pull/266)).
- A `Source:` designation written over two lines is read.

## v0.5.2, 2026-08-14

### Fixed

- A `Source:` designation is read past the post's own media link ([#264](https://github.com/vidithq/vidit/pull/264)).
- A locked URL field is a clickable link.

### Changed

- Re-importing an X archive updates the drafts it already produced, without restoring admin-removed events or rejected detections.

## v0.5.1, 2026-08-14

### Changed

- The sidebar identity row shows your profile picture ([#263](https://github.com/vidithq/vidit/pull/263)).
- The Railway deploy job exits on the deployment's final status ([#260](https://github.com/vidithq/vidit/pull/260)).

### Fixed

- The detections queue's Ready and Incomplete filter is applied by the server ([#261](https://github.com/vidithq/vidit/pull/261)).

## v0.5.0, 2026-08-13

### Added

- A graphic-content gate, anonymous reporting with takedown, and the legal pages ([#255](https://github.com/vidithq/vidit/pull/255)).
- `make import-prod` fills a local database from the latest production backup.
- A public archive-import guide, and every guide links back to its hub.
- Profile and event links unfurl as share cards.
- A review flow for imported drafts, and a digest email of drafts awaiting completion.
- Analysts archive a source link with a web archive from the form that declares it.
- The public profile is an analyst's portfolio ([#227](https://github.com/vidithq/vidit/pull/227)).
- Authenticated reads have a per-user quota ([#226](https://github.com/vidithq/vidit/pull/226)).

### Changed

- The profile opens on the detections queue, and its coverage map includes drafts.
- The media viewer covers the full screen from every page.
- Local Postgres runs the stock `postgis/postgis:16-3.4` image.
- The event share card's locator panel draws a coastline.
- Every list response is capped at 100 rows and pages with a cursor, and `/timeline` orders by submission.
- `GET /events/points` requires `?bbox=`, and the map fetches per viewport ([#223](https://github.com/vidithq/vidit/pull/223)).
- Every documented rate limit has a behavior test ([#226](https://github.com/vidithq/vidit/pull/226)).
- Events can carry secondary source links ([#229](https://github.com/vidithq/vidit/pull/229)).
- Analysts can download a detection's media from its source post, and paste, open or copy coordinates ([#232](https://github.com/vidithq/vidit/pull/232)).
- The bot's mention format no longer requires `T:` ([#230](https://github.com/vidithq/vidit/pull/230)).
- The product is labeled Beta instead of closed beta.
- Backups run daily, S3 media replicates across regions, and a dead-man's-switch ping watches the backup.

### Fixed

- The frontend and backend security checks match again.
- The promo capture scripts work against the current API ([#246](https://github.com/vidithq/vidit/pull/246)).
- The shared pages work on a phone.
- Self-thread imports keep the thread head, the source link and the video.
- Archive import skips retweets ([#222](https://github.com/vidithq/vidit/pull/222)).

### Removed

- Synthetic demo data, the claims ("N working") mechanic, `GET /auth/invites/{code}/check`, dead columns, and unused frontend and backend code.
- The second pagination style on `/timeline` and `/events/detections`.

### Security

- Proof-image sources reject obfuscated protocol-relative URLs.
- The localhost CORS pattern is dropped on a non-local deployment.

## v0.4.10, 2026-08-11

### Fixed

- Archive import accepts staged zips up to 4 GB, and an over-limit upload says so ([#220](https://github.com/vidithq/vidit/pull/220)).

## v0.4.9, 2026-08-10

### Added

- Two public guide pages ([#216](https://github.com/vidithq/vidit/pull/216)).

### Removed

- The trusted-contributor mechanism ([#217](https://github.com/vidithq/vidit/pull/217)).

### Changed

- The public pages are easier to discover and carry less noise ([#216](https://github.com/vidithq/vidit/pull/216)).

## v0.4.8, 2026-07-31

### Changed

- The landing roadmap shows only the near term ([#204](https://github.com/vidithq/vidit/pull/204)).

## v0.4.7, 2026-07-31

### Changed

- Bot replies give a pass or fail verdict with targeted fixes, and the relay form uses the reply's source link.

### Fixed

- Detection deduplication takes the declared source into account.
- The landing hero has a read path for signed-out visitors.
- A stray CSS class name no longer shows in the About page methodology text.
- The map no longer fails once a dateless event is geolocated.
- `/favicon.ico` is served, so Google shows the site icon.

## v0.4.6, 2026-07-23

### Added

- Bot mentions accept a bare three-line format and relay delivery, with a `/bot` guide ([#184](https://github.com/vidithq/vidit/pull/184)).
- An admin onboarding screen ([#182](https://github.com/vidithq/vidit/pull/182)).

### Changed

- `event_date` is optional at publish.

## v0.4.5, 2026-07-22

### Changed

- The bot stores any `S:` link as the source ([#178](https://github.com/vidithq/vidit/pull/178)).
- The backend test suite runs in parallel ([#180](https://github.com/vidithq/vidit/pull/180), [#181](https://github.com/vidithq/vidit/pull/181)).

### Fixed

- `GET /events` no longer scans the whole media table from the second request on ([#179](https://github.com/vidithq/vidit/pull/179)).

## v0.4.4, 2026-07-21

### Changed

- Card thumbnails fall back to the proof image.

## v0.4.3, 2026-07-21

### Fixed

- Search results show their media thumbnails.

## v0.4.2, 2026-07-21

### Added

- The promo video pipeline for v0.4.
- Frontend observability: a Sentry tunnel that ad blockers do not block, plus Vercel Analytics and Speed Insights.
- A lifecycle Status filter on the shared event filter panel ([#169](https://github.com/vidithq/vidit/pull/169)).
- Bot mentions arrive by webhook, with a defined response model.

### Fixed

- The Sentry tunnel works for anonymous readers.
- Every co-located map event is reachable through counted stack badges, a hover fan-out, pin previews and a smooth cluster handoff.

### Changed

- The bot accepts only a strict single-tweet mention format.
- The map has a zoom floor.
- Archive uploads go directly to S3 through presigned URLs, and per-media limits replace the archive size cap.
- Bot attribution goes only to admin-linked accounts.

## v0.4.1, 2026-07-17

### Changed

- Railway scheduled jobs share one scheduler config ([#143](https://github.com/vidithq/vidit/pull/143)).

## v0.4.0, 2026-07-17

### Added

- Archive import runs on a durable worker and sends a completion email.
- The map and search share one filter language.
- Search and the profile's Show more link filter by exact author, picked from a typeahead.
- The profile shows the author's geolocation stats.
- Anonymous visitors can read the site.
- The map filter offers Hide demo data only when demo rows are on the map.
- Tagging @ViditBot on X creates a `detected` draft and replies in the thread.
- Archive backfill: import your X data export to create `detected` geolocations.
- An owner review queue to edit, validate or reject machine-detected geolocations ([#96](https://github.com/vidithq/vidit/pull/96)).
- Admin metrics for detection quality: machine reject rate and pending missing-piece counts.
- Conflicts come from a synced reference list, and tags reduce to capture source plus free tags.
- One submit form, and "bounty" is renamed "request".
- A light theme and a selectable accent palette in Settings.
- A gold-path integration test and behavior tests for read rate limits.
- A `vulture` dead-code gate on the backend, and shared fixtures, components and query helpers for requests.

### Changed

- Machine detections may lack a source URL or post time, promotion requires a source, and archive import captures video.
- One event model covers requests, geolocations and detections, and the internal rename to `event` is complete.
- Events record `event_time`, `source_posted_at` and `detected_post_at` separately.
- `validated` is renamed `submitted`, the `state` field is renamed `status`, and a `detected` row is read-only until submitted.
- An incomplete form highlights every missing field at once with one shared notice.
- Frontend enum and composite response types are generated from the OpenAPI spec ([#103](https://github.com/vidithq/vidit/pull/103)).
- The design system gains three control primitives, and the sidebar rail and page frame are leaner.
- Shared validation constants for upload MIME types, coordinate bounds and password length ([#102](https://github.com/vidithq/vidit/pull/102)).
- Shared frontend mutation and auth-guard hooks ([#101](https://github.com/vidithq/vidit/pull/101)), shared backend router and service helpers ([#100](https://github.com/vidithq/vidit/pull/100)), and per-concern geolocation sub-routers ([#98](https://github.com/vidithq/vidit/pull/98)).

### Removed

- The legacy `/bounties` redirects and the request-to-geolocation promotion flow.

### Fixed

- `?` help tooltips no longer clip, fire only on the icon, and close on mouse-out.
- Empty date and time inputs no longer look filled.
- The back arrow walks back through history instead of bouncing between two pages.

### Security

- The tweet media proxy refuses redirects and scrubs logged URLs ([#99](https://github.com/vidithq/vidit/pull/99)).

## v0.3.4, 2026-06-25

### Changed

- The landing roadmap marks v0.3 as current ([#95](https://github.com/vidithq/vidit/pull/95)).

## v0.3.3, 2026-06-25

### Changed

- The landing roadmap shows versions instead of status tags ([#93](https://github.com/vidithq/vidit/pull/93)).
- Geolocation and request creation merge into one `/submit` page, grouped like the detail page, with import inside the form ([#93](https://github.com/vidithq/vidit/pull/93)).
- `?` field help comes from one concept registry, covers the detail page, and can be hidden ([#93](https://github.com/vidithq/vidit/pull/93)).
- Share buttons are a lighter control, and the three dates sit together on the detail page ([#93](https://github.com/vidithq/vidit/pull/93)).

### Added

- Requests gain an optional Proof field ([#93](https://github.com/vidithq/vidit/pull/93)).
- Geolocations record when the source posted the media, and requests can record an event date and a source date ([#93](https://github.com/vidithq/vidit/pull/93)).
- The first data model for machine-detected geolocations ([#90](https://github.com/vidithq/vidit/pull/90)).

## v0.3.2, 2026-06-21

### Changed

- The roadmap uses a single version ladder and shows the curated onboarding phase ([#80](https://github.com/vidithq/vidit/pull/80)).

## v0.3.1, 2026-06-21

### Added

- A profile can exist before its owner signs in.

### Changed

- TypeScript 6 with a current compile target ([#67](https://github.com/vidithq/vidit/pull/67)).

## v0.3.0, 2026-06-10

### Security

- Request creation applies the same evidence-intake checks as geolocations ([#44](https://github.com/vidithq/vidit/pull/44), [#55](https://github.com/vidithq/vidit/pull/55), [#56](https://github.com/vidithq/vidit/pull/56)).
- One shared rate limiter caps every write that had no limit ([#55](https://github.com/vidithq/vidit/pull/55)).
- Backend and frontend lockfiles are refreshed against open Dependabot advisories.
- Next.js 15.5 closes 13 open `next` advisories ([#1](https://github.com/vidithq/vidit/pull/1)).
- Changing a password invalidates existing sessions.

### Added

- The repository is public.
- A Vitest and Testing Library harness, with per-commit checks in one `ci.yml` ([#49](https://github.com/vidithq/vidit/pull/49)).
- Dependabot version updates and a CodeQL workflow, and GitHub Actions bumped to current versions ([#21](https://github.com/vidithq/vidit/pull/21), [#22](https://github.com/vidithq/vidit/pull/22), [#23](https://github.com/vidithq/vidit/pull/23)).
- DCO sign-off is required on contributions ([#16](https://github.com/vidithq/vidit/pull/16)).
- The landing, the About page and the sidebar link to the GitHub repository.
- Open Graph and Twitter card metadata on `/` and `/about`.
- A Request access control on the landing.

### Fixed

- The doc-sync workflow is simplified and renamed `docs-pairing` ([#7](https://github.com/vidithq/vidit/pull/7)).
- The Bounties nav item highlights on bounty sub-pages.
- Bounty video media shows its first frame instead of a blank tile.
- The bounty Working on row no longer appears mid-frame.

### Changed

- Config that enforced nothing and prose that described missing behavior are removed ([#55](https://github.com/vidithq/vidit/pull/55), [#57](https://github.com/vidithq/vidit/pull/57)).
- The map, profile, submit and admin pages split into components ([#50](https://github.com/vidithq/vidit/pull/50), [#51](https://github.com/vidithq/vidit/pull/51), [#52](https://github.com/vidithq/vidit/pull/52), [#53](https://github.com/vidithq/vidit/pull/53)).
- Shared `AuthCard` and `SingleEmailFlow` components and a `useApiResource` fetch hook ([#47](https://github.com/vidithq/vidit/pull/47), [#48](https://github.com/vidithq/vidit/pull/48)).
- Backend business logic moves from routers into services, with a shared S3 cleanup helper and typed admin errors.
- Sentry on Next.js reports request errors and supports Turbopack.
- Tailwind CSS 4 ([#34](https://github.com/vidithq/vidit/pull/34)) and ESLint 9 with flat config ([#33](https://github.com/vidithq/vidit/pull/33)).
- React 19 ([#32](https://github.com/vidithq/vidit/pull/32), [#38](https://github.com/vidithq/vidit/pull/38)) and Next.js 16 ([#31](https://github.com/vidithq/vidit/pull/31), [#37](https://github.com/vidithq/vidit/pull/37)).
- The `docs-pairing` CI check skips Dependabot PRs ([#24](https://github.com/vidithq/vidit/pull/24)).
- The tweet-import banner reduces to one button after import.
- `POST /tags` is idempotent for the same name and category.
- The promo recording logs in as a community analyst, with a click-only cursor, separate data wipes and matched timing.
- The README, the About page and the documentation structure are revised, and the landing demo video is wired up.
- The public roadmap goes from four milestones to three.

## v0.2.0, 2026-06-06

### Security

- CI actions are pinned by SHA with least-privilege permissions ([#102](https://github.com/vidithq/vidit/pull/102)).
- Per-IP rate limits key on the real client IP and resist `X-Forwarded-For` spoofing.
- Proof images reject protocol-relative URLs.
- Admin escalation through email letter case is fixed.
- Request bodies have a size cap ([#100](https://github.com/vidithq/vidit/pull/100)), and `POST /geolocations` caps the files per submission.
- S3 keys take their extension from the validated MIME type, not the filename.
- Bad date filter values return 422 instead of 500.
- `POST /geolocations` validates its fields before any S3 upload.
- `POST /tags` and bounty claims no longer fail on concurrent writes.

### Added

- The AGPL-3.0 license and contributor docs ([#102](https://github.com/vidithq/vidit/pull/102)).
- A public landing page at `/`.
- A tweet URL pre-fills the geolocation submit form ([#96](https://github.com/vidithq/vidit/pull/96)).
- Share buttons on the geolocation detail page and the map side panel.
- A fallback message on the map when WebGL is missing.
- Capture-source tags, with a map filter and a curated tag query ([#97](https://github.com/vidithq/vidit/pull/97)).
- A promo video pipeline built as code.

### Changed

- The map moves from `/` to `/map`.
- Authentication defaults to deny, replacing the closed-beta gate.
- The sidebar is the same on every page, and sign-in controls hide when you are signed in.
- Home and About are deduplicated and trimmed.
- A geolocation requires a conflict and a capture source, picked from two curated selectors and shown as chips ([#97](https://github.com/vidithq/vidit/pull/97)).
- Submit forms share tag and media preview components, and the media section becomes Source media with thumbnails ([#97](https://github.com/vidithq/vidit/pull/97)).
- The proof editor accepts initial content.
- The demo seeder attaches a capture source and a conflict ([#97](https://github.com/vidithq/vidit/pull/97)).
- The docs are reorganized into milestones and checked against the code ([#97](https://github.com/vidithq/vidit/pull/97), [#98](https://github.com/vidithq/vidit/pull/98)).

### Removed

- The closed-beta gate.

### Fixed

- Signed-in visitors no longer see a login form flash.
- `/i/web/status/` tweet URLs normalize to a valid canonical URL.
- The tweet media proxy streams and stops above the size cap, the tweet import cache is bounded, and tweet import can be canceled.

## v0.1.2, 2026-05-21

### Changed

- The Discord invite link is a new permanent invite ([#92](https://github.com/vidithq/vidit/pull/92)).

## v0.1.1, 2026-05-20

### Added

- Analysts can create free tags from the submit forms.
- Map filter chips allow several selections, and the tag filters on `/geolocations` and `/geolocations/points` accept several values.

### Changed

- `POST /tags` validates names more strictly.
- The points cache key no longer depends on the order of filter values.

## v0.1.0, 2026-05-20

### Added

- Protected pages redirect to sign-in at the edge, and an empty own profile invites a first submission.
- The submit form warns about possible duplicates nearby, through `GET /geolocations/possible-duplicates`.
- Frontend errors report to Sentry.
- Uploaded images get JPEG hero and thumbnail versions, and pages load the right size.
- Changing a password sends a heads-up email.
- Weekly automated database backups to S3, with a verified restore drill.
- `TRUSTED_PROXY_HOPS` sets how many proxy hops to trust when reading the client IP.
- Runbooks for observability and maintenance.
- A five-bucket orange palette and a shared `PageShell` layout on every in-app page.
- Shared code for author references, audit logging, author checks, form styles and source labels; resending a confirmation is audited.

### Changed

- Registration errors are structured.
- The points cache key is hashed.
- The S3 CORS rule allows `vidit.app`, and new objects get a 365-day Object Lock retention.
- Non-canonical frontend hosts redirect to `vidit.app`.
- The bounty list defaults to open bounties, the bounty detail page is redesigned, and fulfilling a bounty lets you edit the title and tags.
- Status pills, tag chips and tappable cards each share one style.
- Frontend module exports are tightened, a no-op Docker Compose setting is removed, and docs are corrected.

### Removed

- Unused schemas and constants, the `WipCard` component, the `react-globe.gl` dependency and an empty frontend Dockerfile.

### Fixed

- `/health` accepts `HEAD`, so uptime monitors report it as up.

## v0.0.9, 2026-05-13

### Added

- Signed-in users can change their password from Settings.
- Uploaded evidence records a SHA-256 hash.
- Error pages show a copyable error digest.
- Image uploads have EXIF and other metadata stripped, and uploads record their provenance.

### Changed

- The `?author=` filter accepts only username characters, which closes a LIKE-injection path.
- UI polish against the design guide, including a clickable trust badge and a report link on the beta banner.
- Back navigation lands on the right page within the app.

### Removed

- Bearer-token authentication; the cookie and CSRF pair is the only way in ([#28](https://github.com/vidithq/vidit/pull/28)).

### Fixed

- A transient `/auth/me` error no longer signs the user out.

## v0.0.8, 2026-05-13

### Fixed

- Dynamic pages no longer return 500 because of the icon font bundling.

## v0.0.7, 2026-05-13

### Fixed

- The icon routes added in [#60](https://github.com/vidithq/vidit/pull/60) no longer return 500 in production and break every page.

## v0.0.6, 2026-05-13

### Changed

- `python-jose` is replaced with `PyJWT`.
- A malformed `bbox` returns 422 instead of returning every row.
- Bounty fulfillment is race-safe and ignores tampered form values.

### Added

- Analysts can follow each other and read a personal timeline.
- Full-text search across geolocations, bounties and analysts.
- Bounties: post footage to geolocate, signal that you are working on it, and fulfill it with a geolocation.
- An admin panel that seeds demo bounties.
- Editable profiles with a bio, an avatar URL and external links.
- A favicon, an Apple touch icon and a web manifest.
- HSTS on every response and an audit log of auth events.

## v0.0.5, 2026-05-11

### Added

- Registration creates an account only after the email address is confirmed.
- Inline images in the proof editor ([#39](https://github.com/vidithq/vidit/pull/39)).
- Forgot-password and email-verification flows ([#41](https://github.com/vidithq/vidit/pull/41)).
- An admin page with invite codes, a trust signal, and soft delete for geolocations and users ([#45](https://github.com/vidithq/vidit/pull/45)).
- A demo data seeder with an admin panel.
- An admin maintenance panel that reaps expired tokens and orphan proof images.

### Removed

- The backend CLI scripts, replaced by the admin page.

### Changed

- The deploy runs `railway up` from the repo root ([#50](https://github.com/vidithq/vidit/pull/50)).
- A `doc-sync` CI workflow fails a PR that changes code without its docs.
- You can resend the confirmation email after losing the pending page.
- Auth pages move to flat URLs such as `/login` ([#41](https://github.com/vidithq/vidit/pull/41)).

### Security

- Authenticated pages no longer fetch third-party assets ([#40](https://github.com/vidithq/vidit/pull/40)).
- Recovery tokens are consumed atomically, so a token cannot be used twice.
- The unguarded invite-code endpoint is removed ([#45](https://github.com/vidithq/vidit/pull/45)).
- Admin search excludes deleted accounts, and login takes the same time whether or not the account exists.

## v0.0.4, 2026-05-06

### Added

- A script that creates an admin user without an invite code ([#36](https://github.com/vidithq/vidit/pull/36)).

### Removed

- The stub report button on `/about` ([#37](https://github.com/vidithq/vidit/pull/37)).

## v0.0.3, 2026-05-06

### Fixed

- The deploy build passes `NEXT_PUBLIC_API_URL` explicitly ([#35](https://github.com/vidithq/vidit/pull/35)).

## v0.0.2, 2026-05-06

### Added

- First public deploy: the frontend at `vidit.app`, the API at `api.vidit.app`, and media on S3 and CloudFront.
- Swappable storage with S3 and local backends ([#18](https://github.com/vidithq/vidit/pull/18)).
- A manual deploy workflow ([#33](https://github.com/vidithq/vidit/pull/33)).
- A closed-beta version badge ([#34](https://github.com/vidithq/vidit/pull/34)).
- An `/about` page ([#32](https://github.com/vidithq/vidit/pull/32)).

### Changed

- The product is renamed Vidit, and the backend builds from a Dockerfile on Railway ([#15](https://github.com/vidithq/vidit/pull/15), [#20](https://github.com/vidithq/vidit/pull/20)).
- The geolocation `analysis` field is renamed `proof` ([#31](https://github.com/vidithq/vidit/pull/31)).
- `CORS_ORIGINS` is set from the environment ([#23](https://github.com/vidithq/vidit/pull/23)).
- The backend refuses to boot with the default `JWT_SECRET` outside localhost.

### Security

- Login and registration rate limits, account lockout, and a hard failure without a JWT secret in production ([#27](https://github.com/vidithq/vidit/pull/27)).
- Session tokens move to an HttpOnly cookie with CSRF protection ([#28](https://github.com/vidithq/vidit/pull/28)).
- Proof content is sanitized on the server ([#30](https://github.com/vidithq/vidit/pull/30)).

### Fixed

- `postgres://` database URLs are normalized for SQLAlchemy 2 ([#21](https://github.com/vidithq/vidit/pull/21)).
- `$PORT` is expanded by the Dockerfile shell ([#22](https://github.com/vidithq/vidit/pull/22)).
- The auth gate matcher is tightened, forwards the invite code, and uses one cookie name ([#25](https://github.com/vidithq/vidit/pull/25)).

## 0.0.1, 2026-05-02

### Added

- Five MVP features on a local PostGIS: invite-only auth, the world map, geolocation submission, the geolocation page and the analyst profile.
- Filters by conflict and tag, a submission rate limit, and the Montserrat font.
- Placeholder pages and work-in-progress markers for upcoming features.
- CI on GitHub Actions for the backend and the frontend ([#4](https://github.com/vidithq/vidit/pull/4)).
