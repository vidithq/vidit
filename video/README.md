# Promo video pipeline

A reproducible "promo as code" pipeline for the Vidit closed-beta promo.
Produces a 1920×1080 / 60fps MP4 with a brand intro, a real recording of
the platform doing the full submit + request flow, captions overlaid on
the recording, and a closing CTA.

The middle of the video is a real Playwright-driven recording of a real
Chrome instance against the local dev backend. The intro / outro /
captions are Remotion compositions wrapping that recording in faked
browser chrome. One render command produces the final MP4.

## Prereqs

Local dev environment up and seeded:

```bash
make init                       # one-shot bootstrap (install + db + migrate)
make seed                       # admin user + 50 demo geolocations + curated tags
make dev                        # backend on :8000, frontend on :3000
```

Then in another shell, prepare the dedicated demo users this pipeline
needs (idempotent — re-running is safe):

```bash
cd backend && uv run python scripts/mock_demo_user.py
```

That creates three non-admin users (`analyst` + `demo-analyst` + `analyst-helper`)
so the request viewer in the recording is NOT also the request author — the
"I'm working on this" button only renders on a request you don't own.
`analyst` is who the recording logs in as (community-handle perspective,
no admin badge); `demo-analyst` owns the seeded requests; `analyst-helper`
pre-seeds the "1 working" indicator on one request in the list view.

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
| Request form's source URL + uploaded video source | `REQUEST_SOURCE_URL` + `REQUEST_TWEET_URL` in `record-submit.js` |
| Cursor speed / scroll cadence | `glideAndClick` defaults + `slowScrollToY` durations in `record-submit.js` |
| Faked browser chrome (URL bar, traffic lights) | `src/components/VideoChrome.tsx` |

## How it works, in 30 seconds

1. **`seed-requests.js`** logs in as `demo-analyst`, wipes that user's old
   requests, then imports a curated list of the real analyst's tweets,
   downloads their video media via the backend's tweet proxy, and posts
   them as requests. It then logs in as `analyst-helper` and claims one
   so the list shows "1 working" social proof. Idempotent.

2. **`record-submit.js`** logs in as `analyst`, opens Chrome headlessly
   with an injected DOM cursor overlay (the OS cursor isn't captured by
   `page.screenshot()`, so we render our own SVG cursor), and drives the
   page through the full flow: map cold open → sidebar tour → submit
   geolocation from a tweet → "I'm working on this" → post a new request
   from a Telegram link → publish. A polling loop calls
   `page.screenshot()` at 30 fps in parallel and writes JPEG frames to
   disk. `ffmpeg` muxes them into `out/recording-submit.mp4` at
   2560×1440.

3. **Remotion** composes intro / outro / captions around the recording
   (loaded via `<OffthreadVideo>`) and renders the final MP4. All the
   text and timings live in `src/Demo.tsx`.

## Known brittleness

- **The backend's `/geolocations/import-from-tweet` endpoint depends on
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
- **User setup.** If you skip `mock_demo_user.py`, the recording's
  login (`analyst@vidit.app`) fails outright. Even if you create just
  `analyst` and skip the rest, requests get posted by `analyst` itself
  instead of `demo-analyst` — viewing their own request in the recording
  would then show "Close this request" instead of "I'm working on this",
  and the recording would fail at that step with a TimeoutError on the
  missing button.

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
cd backend && uv run python scripts/mock_demo_user.py   # analyst user
make seed                                               # demo map data
make dev-worker                                         # the import worker must run
cd video
npm run record:v04   # or: node record-v04.js map,import,queue,promote,bot-embed
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
