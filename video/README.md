# Promo video pipeline

A reproducible "promo as code" pipeline for the Vidit promo.
Produces a 1920×1080 / 60fps MP4 with a brand intro, a real recording of
the platform doing the full submit + request flow, captions overlaid on
the recording, and a closing CTA.

The middle of the video is a real Playwright-driven recording of a real
Chrome instance against the local dev backend. The intro / outro /
captions are Remotion compositions wrapping that recording in faked
browser chrome. One render command produces the final MP4.

## Prereqs

Local dev environment up, against a populated catalog:

```bash
make init                       # one-shot bootstrap (install + db + migrate)
make import-prod                # restore the latest production backup locally
make dev                        # backend on :8000, frontend on :3000
```

The catalog on camera comes from a production import (`make import-prod`)
or from an archive import through `/submit`. Every take reads whatever the
instance holds, so record against an instance you are willing to publish:
the recordings show real handles, real media and real coordinates.

Takes that sign in need their account to exist on that instance already.
`record-submit.js` and `record-v04.js` log in as `analyst@vidit.app`;
`seed-requests.js` posts as `demo-analyst`, deliberately a different user,
because an owner viewing their own request sees "Close this request" where
the recording expects "Geolocate this". `record-v05.js` signs in to nothing
and needs no account.

## Generate the promo (one command)

From the repo root:

```bash
make promo
```

That runs: seed requests from the analyst's tweets → record the live
Chrome flow → mux frames to MP4 → Remotion render the final composition.
Output: `video/out/promo-final.mp4`.

To run the steps by hand (useful when iterating on one of them):

```bash
cd video
node seed-requests.js                                    # ~30s — fetches tweets, posts requests
node record-submit.js                                    # ~60s — drives Chrome, records frames, encodes
cp out/recording-submit.mp4 public/                      # Remotion needs it under public/
npx remotion render src/index.ts Demo out/promo-final.mp4 --codec h264 --crf 16    # ~30s
```

For 4K (3840×2160), append `--scale 2` to the render command.

## What lives where

| Want to change… | File |
|---|---|
| Scene timings + caption text + outro feature list | `src/Demo.tsx` (`CAPTIONS` + `SCENES`) and `components/Outro.tsx` (`ALSO_IN_VIDIT`) |
| Brand colours / wordmark / tagline | `src/components/Intro.tsx`, `Outro.tsx`, `Background.tsx`, `fonts.ts` |
| Tweets used to seed the request list | `TWEETS` at top of `seed-requests.js` |
| Tweet imported in the recording's geolocation submit | `TWEET_URL` at top of `record-submit.js` |
| Request form's source URL + uploaded video source | `REQUEST_SOURCE_URL` + `REQUEST_TWEET_URL` + `REQUEST_SOURCE_POSTED_AT` in `record-submit.js` |
| Conflict + capture source both scripts classify with | `CONFLICT_NAME` / `CAPTURE_SOURCE_NAME` at the top of `seed-requests.js` and `record-submit.js` (keep them equal) |
| Cursor speed / scroll cadence | `glideAndClick` defaults + `slowScrollToY` durations in `record-submit.js` |
| Faked browser chrome (URL bar, traffic lights) | `src/components/VideoChrome.tsx` |

## How it works, in 30 seconds

1. **`seed-requests.js`** logs in as `demo-analyst`, wipes that user's old
   requests, then imports a curated list of the real analyst's tweets,
   downloads their video media via the backend's tweet proxy, and posts
   them as requests (`POST /events/requests`, one source file each).
   Idempotent.

2. **`record-submit.js`** logs in as `analyst`, opens Chrome headlessly
   with an injected DOM cursor overlay (the OS cursor isn't captured by
   `page.screenshot()`, so we render our own SVG cursor), and drives the
   page through the full flow: map cold open → sidebar tour → submit a
   geolocation from a tweet on `/submit` → read a request on the requests
   board → post a new request from a Telegram link on the same form →
   publish. A polling
   loop calls `page.screenshot()` at 60 fps in parallel and writes JPEG
   frames to disk. `ffmpeg` muxes them into `out/recording-submit.mp4` at
   2560×1440, at the fps the grabber actually sustained.

   One form serves both publishes: `/submit` opens on the Single entry
   path, the recording picks *From an X post* to reveal the tweet-import
   banner, and the two actions at the foot of the form are *Publish
   geolocation* and *Publish request*. Classification is two referentials,
   so the recording searches the conflict in its typeahead and clicks the
   capture source among the curated chips.

3. **Remotion** composes intro / outro / captions around the recording
   (loaded via `<OffthreadVideo>`) and renders the final MP4. All the
   text and timings live in `src/Demo.tsx`.

## Known brittleness

- **The backend's `/events/import-from-tweet` endpoint depends on
  live X scraping.** If X changes its HTML, the seeding falls back to
  less-rich media (or to an image instead of the source video). The
  `seed-requests.js` log lines call out when this happens (`video fetch
  failed; falling back to images`).
- **Tweet URLs are hardcoded** — 2 in `TWEETS` (seed-requests.js for the
  seeded request list) + `TWEET_URL` (record-submit.js, the geolocation
  the recording submits) + `REQUEST_TWEET_URL` (record-submit.js, only
  used to source the video for the live request upload). Four
  references total, three distinct tweets. If the original author
  deletes them, swap in other geolocation tweets from any analyst
  who's given permission. The duplicate-cleanup step (the one that
  prevents stale "possibly related" warnings) and the
  request-upload cache key both derive from these constants — no other
  knobs to update.
- **The pipeline assumes the local dev stack is running.** Backend at
  `:8000` and frontend at `:3000`. No remote/headless mode — Playwright
  drives the real Next.js frontend.
- **A route rename anywhere else in the repo breaks the scripts.** They
  call the live API and click real frontend paths, and no test suite
  covers them, so a rename lands silently and every call 404s at the next
  render. `video/check-routes.sh` greps both scripts for the spellings
  that have already gone stale once; it runs in `make hygiene` and in
  CI's hygiene job. Selectors are beyond a grep's reach, so a form
  restructure still needs a capture run to catch.
- **User setup.** The signed-in takes assume two accounts on the
  instance. Without `analyst@vidit.app` the recording's login fails
  outright. With `analyst` but no `demo-analyst`, requests get posted by
  `analyst` itself, so viewing their own request in the recording shows
  "Close this request" instead of "Geolocate this" and the take fails at
  that step with a TimeoutError on the missing control.

## Why this stack

- **Why Remotion over a video editor:** every text change is a code
  change, every timing tweak is a number in a TypeScript array, every
  re-render is one command. The promo evolves with the product without
  a manual editing pass.
- **Why Playwright `page.screenshot()` instead of `recordVideo`:**
  `recordVideo` is locked at 25 fps VP8 ~650 kbps and ignores
  `deviceScaleFactor` (blurry on retina). A polling-loop screenshot
  grabber respects DPR and gives true 2560×1440 frames at 30 fps.
- **Why a DOM cursor overlay:** the OS cursor isn't part of the page
  bitmap that `page.screenshot()` returns. Rendering our own SVG cursor
  inside the page (tracked off the real Playwright mouse events) is
  the cleanest way to make it appear in the recording.
- **Why `slowScrollToY` instead of `scrollIntoView({ behavior: "smooth" })`:**
  the browser's native smooth scroll runs at a fixed (fast) cadence
  with no duration control; a custom ease-in-out over 1.5–2.5 s reads
  like someone gently scrolling the trackpad. The implementation fires
  the rAF loop in the page WITHOUT awaiting the resulting Promise — an
  awaited `page.evaluate(asyncFn)` blocks the CDP session and tanks
  the screenshot grabber from 30 fps to ~4 fps.

## v0.4 promo (`PromoV04`)

A second pipeline, sharing the capture technique above but recording one
clip per beat instead of one continuous take, so the comp can pace beats
independently and slot in real X screen captures.

```bash
make import-prod     # a populated catalog for the map beats
make dev-worker      # the import worker must run
cd video
npm run record:v04   # or: node record-v04.js demo,bot-embed
npm run render:v04   # → out/promo-v04.mp4 (1920×1080, 60 fps)
```

The recorded takes import the maintainer's REAL X export ("Vidit
stuff.zip" at the repo root, their published geolocation work), copied
read-only to `out/real-archive.zip`, so every draft and event on camera
carries real media. `gen-archive.js` (a synthetic real-shaped archive)
stays for CI / reproducibility when the real export isn't available.

Per clip (all real UI, none of it staged on camera): `map.mp4` opens the
anonymous map, dezooms to clusters and opens a real promoted geolocation
(one draft from the real archive, promoted at setup and remembered in
`out/hero.json`); `import.mp4` uploads the real archive through `/submit`
and lands on the filled detections queue; `queue.mp4` is a steady queue
shot; `promote.mp4` reviews a real draft, submits it and shows the
published point; `bot-embed.mp4` records the official X embed (dark) of
the analyst's real coordinate tweet as the bot beat's base plate. Timing
marks from each take go to `public/clips/meta.json`;
`gen-clips-manifest.js` compiles them into `src/clips-manifest.ts`, which
`src/PromoV04.tsx` reads, so a re-record never needs hand-retimed
sequences. The comp letterboxes every recording above a reserved caption
band, so captions never overlap the demo.

### Maintainer drop-in slots (real X footage)

Two beats are meant to be REAL X screen recordings, captured manually:

| Slot file | Used by | Until it exists |
|---|---|---|
| `public/clips/bot-x-capture.mp4` | `PromoV04` bot beat (tweet → tag `@viditbot` → like → reply) | the interim composite renders: the real X embed recording (`bot-embed.mp4`) plus an overlay of the tag reply, like, and bot reply in X's dark idiom |
| `public/clips/x-export-capture.mp4` | `FeatureImport` opening (Settings → "Download an archive of your data") | a styled placeholder card renders instead |

Drop the file in, re-run `node gen-clips-manifest.js`, re-render. The
capture is scaled and center-cropped into the same browser-chrome frame
as the app clips; any aspect ratio works, 16:9 crops least.

`FeatureImport` is the follow-up feature video on the archive import
(scaffolded, not rendered for v0.4): `npm run render:feature-import`.

## v0.5 promo A, the portfolio (`PromoV05`)

An analyst's public profile as a portfolio: the brand intro, ONE unbroken
take, the closing card. Recorded **logged out**.

```bash
make promo-v05       # record + render + both outputs
```

Or step by step:

```bash
cd video
npm run record:v05   # → public/clips/portfolio.mp4 + its marks
npm run render:v05   # → out/promo-v05.mp4 (1920×1080, 60 fps)
```

`make promo-v05` adds the two staged outputs: `out/promo-v05-master.mp4`
(the same 1080p stream remuxed with `+faststart`, for S3) and
`out/promo-v05-readme.mp4` (720p / 30 fps, for a GitHub attachment URL).

### One take, no cuts

The recorded part is a single continuous window of `portfolio.mp4`. Nothing
in it is assembled: the page travels by scrolling, the camera travels by
easing, and both page changes are in-page router pushes the take performs on
camera (a submission card, then the sidebar's Map link). The only two
transitions in the video are the crossfades into and out of the recorded
part, where the world genuinely changes.

That constraint moves the editing into the capture. `record-v05.js` is paced
in real time, holds included, and its length IS the promo's recorded length,
so a hold that runs long there runs long on screen. `PromoV05.tsx` has no
windowing machinery left: it places three scenes and hangs captions off the
take's marks.

Two consequences worth knowing before you re-record:

- A route compiling for the first time cannot be cut out, so the take runs a
  silent warm-up pass over every route it will visit before it starts
  recording.
- Never navigate with `page.goto` inside the recorded pass. A reload blinks
  the page white, and there is no cut available to hide it.

| Beat | What is on camera | Caption |
|---|---|---|
| Intro | The wordmark, the release, and the tagline | |
| 1 | The identity block: avatar, handle, bio. Motionless, no cursor. | Your work, on one page. |
| 2 | The travel down the page: the counters strip passes through, the coverage map lands. | Every event you documented. |
| 3 | The coverage map, fitted to the analyst's own points on mount, then a camera ease into the densest worked area. | The ground you covered. |
| 4 | On down to the submissions, one opens: source media, the point map, coordinates, the source row with its archived copy, the written proof. | The source, and a copy that outlives it. |
| 5 | The general map, pulling back so the analyst's points sit among everyone else's. | One archive, open to read without an account. |
| Outro | The wordmark and vidit.app (`OutroV04`, shared with the v0.4 promo) | |

### Why the capture window is short and wide

The take captures at 1040x560, not the 1280x720 the other pipelines use,
because on a phone the product has to be readable. How big the page reads in
the frame comes out to:

    on-screen column width = comp body height x (page column width / capture height)

The profile's content column caps at 848 CSS px whatever the window width, so
a wider capture only buys dark gutters. A SHORT capture is what magnifies the
page. At 1040x560 the comp shows the recording at 1.56x rather than shrinking
it to 0.92x, the window covers 85% of the frame width instead of 61%, and the
counters and the coverage split survive a 400 px downscale.

The two dimensions are chosen, not rounded:

- **1040 wide** keeps the desktop layout (above Tailwind's `lg`) with the
  content column at its 848 px cap.
- **560 tall** ends the frame in the gap under the identity block and above
  the counters strip, so the opening holds the handle, the avatar and the bio
  with nothing cut in half. The counters stay out of the still opening on
  purpose: zero followers is the weakest thing on the page, so the travelling
  passes through it rather than resting on it. The profile leads with identity
  and puts the counters straight under it, so treat 560 as a landmark to
  re-check on each capture rather than a fixed number.

`CAPTURE` in `PromoV05.tsx` derives the browser body from those numbers, so
the body always carries the take's aspect ratio and `objectFit: cover` has
nothing to crop. Change the viewport in `record-v05.js` and change `CAPTURE`
with it, or the recording gets squashed.

Judge any change to this the way it will be watched: export a frame, scale it
to 400 px wide, and check the counters and the coverage split's labels.

### Where the intro's version comes from

`gen-clips-manifest.js` writes `src/build-version.ts` on every render. It
mirrors the resolution order in
[`frontend/next.config.mjs`](../frontend/next.config.mjs), the one that bakes
`NEXT_PUBLIC_BUILD_VERSION` for the app's version pill: an explicit env var
first, then `git describe --tags --always --dirty`, then `dev`. Change one and
change the other.

The comp renders only the RELEASE part of it, so `v0.5.3-4-gf3ae76f` becomes
`0.5`: a promo names the release, not the build. A version that is not
tag-derived (a bare SHA, `dev`) has no release to name and the intro renders
the plain wordmark.

The release rides the wordmark's own entry spring rather than the tagline's
later fade, so it is legible in frame 0, which is the poster a tweet shows
before anyone presses play.

### Two editorial rules the take enforces

- **No session.** The owner view of a profile carries the account's email
  address and owner-only chrome (Edit profile, the detections banner, Sign
  out), none of which belongs in a promo. Recording anonymously is also the
  honest form of the claim the last caption makes. The take signs in to
  nothing, submits no form and writes nothing.
- **Only the analyst's public page.** `HANDLE` at the top of `record-v05.js`
  names the analyst who consented to being filmed. The take visits their
  profile, one of their events, and the public map.

Retarget it to another analyst by changing `HANDLE`, `COVERAGE_CENTER` and
`COVERAGE_ZOOM`, and by pointing `TARGET_EVENT` at an event that passes
`verifyTarget`.

### The event the take opens

`TARGET_EVENT` is checked before a frame is captured, and the script refuses
to record if any of it stops holding:

- `archived_source` is set. This is the copy of the SOURCE link, which is the
  one beat 4 frames. An event can carry a copy of a secondary source or of
  the post it was detected from and still show an empty glyph on the Source
  row, so those two fields do not qualify it.
- Source media, coordinates and a written proof, so the frame carries what
  the caption claims.
- It is in the Recent submissions the profile lists, since that is the card
  the cursor clicks.

To give an event its archived copy, capture the source yourself and record
the snapshot through `POST /events/{id}/archives` as the owner. Look the
capture up in Wayback's CDX API first (`https://web.archive.org/cdx/search/cdx?url=<source>&output=json&filter=statuscode:200`)
and submit one through Save Page Now only if none exists. Save Page Now
structurally refuses `x.com`, which is where most sources here live;
`t.me` and `tiktok.com` capture fine. Load the replay URL before you record
it: the CDX index lists captures that the replay layer will not serve, and a
snapshot URL that does not resolve is worse than an empty glyph.

## v0.5 promo B, import and review (`PromoV05B`)

About 31 seconds of take between the brand intro and the closing card: an
archive import and a review pass, recorded **signed in** as the analyst who
consented to appear. One continuous take, and the beats dissolve into each
other rather than cutting, because a hard cut between two frames of the same
session reads as a glitch.

```bash
make promo-v05b      # record + render + both outputs
```

Or step by step:

```bash
# 1. the fixture: a trimmed copy of the analyst's own export
backend/.venv/bin/python video/prep-review-take.py \
    --archive "<their export>.zip" --username MPGeoint \
    --creating --threads 14 --out video/out/x-archive-trimmed.zip

# 2. the take and the render
cd video
VIDIT_DEMO_PASSWORD=… npm run record:v05b   # → public/clips/import-review.mp4
npm run render:v05b                          # → out/promo-v05b.mp4
```

The beats, all windows of the one take:

| # | Beat | What is on camera |
|---|---|---|
| 1 | Bulk import | The export guide on `/submit`, the mock open dialog, the staged file with its real name and byte size. |
| 2 | Privacy | The live progress steps, held on `DMs, messages and account data never leave your device.` |
| 3 | Idempotence | The finished run and its outcome line. |
| 4 | The queue | The queue on `All`, where `Ready to review` and `Missing: …` badges sit side by side, then the readiness filter with the server's whole-queue counts. |
| 5 | The review pass | `Draft n of m`, the footage, the coordinates and the source, then the conflict typeahead and the capture source. |
| 6 | Submit | The proof, both submit clicks, and the next draft opening on its own. |
| 7 | The map | The camera easing onto the field the pass just worked. |
| 8 | Closing card | `OutroV04`, shared with the other promos. |

### This take writes to the instance

Unlike promo A, which is a read-only logged-out take, this one signs in,
imports an archive and submits one draft. Point it at a local instance.
`record-v05b.js` opens with the editorial rules it enforces; the two that
constrain the shoot most:

- **One analyst's archive only.** The account it signs into and the export it
  imports belong to the same analyst, the one who consented. No post is ever
  attributed to an account other than its author.
- **The conflict is not guessed.** The review beat fills a conflict, which is
  a claim about someone else's work. `conflictQueryFor` maps a few coordinate
  boxes to a conflict by name, and a draft whose coordinates fall outside them
  is not filmed at all rather than tagged with the nearest plausible war. The
  capture source stays `Unknown`, which asserts nothing.

### The import beat films an idempotent re-import, on purpose

Since v0.5.2 an import matches the drafts it already produced and updates them
in place (`_disposition` in `services/detection.py`). On an instance that
already holds the analyst's whole export, a re-import therefore creates
nothing, and the panel says so: `Everything in that archive is already up to
date (N geolocations)`.

That is what beat 3 films, and the caption says exactly that. The tempting fix
is to caption it as a haul anyway; the honest fixes are to delete the drafts
first so the import genuinely re-creates them, or to import an export the
instance has never seen. Run `prep-review-take.py --report` before a shoot: it
replays the disposition rule against the database and prints how many
detections the export would create, update and skip, so the storyboard is
written against what the import will actually do.

`prep-review-take.py` reads the export with the backend's own ingest modules,
never writes to the database, and produces one file: the trimmed zip. Trimming
is what the import panel itself recommends, and it keeps a 2 GB export inside
a single take.

## Shared capture harness

`capture-lib.js` holds everything the takes have in common: the DOM cursor
overlay, the chrome the recordings must not show (the version pill, the
Next.js dev indicator), the motion vocabulary (`glideAndClick`,
`slowScrollToY` / `slowScrollToLocator` / `slowScrollPanel`, `easeCamera`,
`dragPan`, `smoothScrollIntoView`, `glideClickStretchedCard`), the mock
macOS open dialog the import takes drive (`injectFinder` / `closeFinder`) and
`createRecorder`, the frame grabber and encoder. A recorder script owns only
its storyboard: which pages it visits, what it clicks, and the marks it
stamps.

`window.__viditMap` is a single global set by whichever `<Map>` mounted last,
so `easeCamera` drives the profile coverage map on `/profile/<username>` and
the main map on `/map` with no per-page wiring. It exists in dev builds only.
