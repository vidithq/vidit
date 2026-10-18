# Promo video pipeline

The promos are code. A Playwright script drives a real Chrome against a local Vidit instance and records frames; a Remotion composition wraps that recording in browser chrome, captions, a brand intro and a closing card. Every composition renders at 1920×1080, 60 fps.

Each capture script (`record-*.js`) opens with a header comment that holds its storyboard, its editorial rules and the reasons behind its constants. Read it before you re-shoot.

## Prerequisites

A local instance with a populated catalog:

```bash
make init          # install, env files, database, migrations
make import-prod   # restore the latest production backup locally
make dev           # backend on :8000, frontend on :3000
```

The catalog on camera is whatever the instance holds, so record against an instance you are willing to publish: the recordings show real handles, real media and real coordinates.

Takes that sign in need their account to exist on the instance already:

| Script | Signs in as |
|---|---|
| `record-submit.js`, `record-v04.js` | `analyst@vidit.app` |
| `seed-requests.js` | `analyst@vidit.app` (viewer) and `demo-analyst@vidit.app` (request author) |
| `record-v05b.js` | `VIDIT_DEMO_EMAIL` / `VIDIT_DEMO_PASSWORD` |
| `record-collections.js` | `PROMO_LOGIN_EMAIL` / `PROMO_LOGIN_PASSWORD` |
| `record-guide.js` | `GUIDE_LOGIN_EMAIL` / `GUIDE_LOGIN_PASSWORD` |
| `shoot-guide.js` | nobody, unless a shot in `shots.json` is `signed-in`: then `GUIDE_LOGIN_EMAIL` / `GUIDE_LOGIN_PASSWORD` |
| `record-v05.js` | nobody (logged out) |

The request author differs from the viewer on purpose: an owner viewing their own request sees *Close this request* where the take expects *Geolocate this*, and the take fails on the missing control. No script in the repo creates these accounts; see [issue #505](https://github.com/vidithq/vidit/issues/505).

## Promos

| Composition | Command | Capture script | Writes to the instance | Outputs in `out/` |
|---|---|---|---|---|
| `Demo` | `make promo` | `seed-requests.js`, `record-submit.js` | yes: seeded requests, one geolocation, one request | `promo-master.mp4`, `promo-readme.mp4` |
| `PromoV04` | `npm run record:v04`, `npm run render:v04` | `record-v04.js` | yes: archive import, one promoted detection | `promo-v04.mp4` |
| `PromoV05` | `make promo-v05` | `record-v05.js` | no | `promo-v05-master.mp4`, `promo-v05-readme.mp4` |
| `PromoV05B` | `make promo-v05b` | `record-v05b.js` | yes: archive import, one submitted draft | `promo-v05b-master.mp4`, `promo-v05b-readme.mp4` |
| `PromoCollections` | `make promo-collections` | `record-collections.js` | yes: one event added to a collection | `promo-collections-master.mp4`, `promo-collections-readme.mp4` |
| `GuideWalkthrough` | `make promo-guide` | `record-guide.js` | no | `guide-walkthrough-master.mp4`, `guide-walkthrough.mp4` |
| `FeatureImport` | `npm run render:feature-import` | none | no | `feature-import.mp4` |

Run the `npm run` commands from `video/`. Every `make` target needs `make dev` running in another shell.

### `Demo`

`make promo` runs `make mock-admin`, seeds requests, records the submit take, copies `out/recording-submit.mp4` into `public/`, and renders. To run the steps by hand:

```bash
cd video
node seed-requests.js
node record-submit.js
cp out/recording-submit.mp4 public/
npx remotion render src/index.ts Demo out/promo-4k.mp4 --codec h264 --crf 16 --scale 2
```

| To change | Edit |
|---|---|
| Scene timings, caption text, outro feature list | `src/Demo.tsx` (`CAPTIONS`, `SCENES`), `src/components/Outro.tsx` (`ALSO_IN_VIDIT`) |
| Brand colours, wordmark, tagline | `src/components/Intro.tsx`, `Outro.tsx`, `Background.tsx`, `src/fonts.ts` |
| Posts that seed the request list | `TWEETS` in `seed-requests.js` |
| Post imported in the submit take | `TWEET_URL` in `record-submit.js` |
| Request source and uploaded video | `REQUEST_SOURCE_URL`, `REQUEST_TWEET_URL`, `REQUEST_SOURCE_POSTED_AT` in `record-submit.js` |
| Conflict and capture source | `CONFLICT_NAME`, `CAPTURE_SOURCE_NAME` in `seed-requests.js` and `record-submit.js` (keep them equal) |
| Faked browser chrome | `src/components/VideoChrome.tsx` |

`seed-requests.js` imports each post in `TWEETS` as detections, reads the stored media from each detection's `storage_url`, posts one request per post, and deletes the detections. The import reads the caller's own posts only, so the seeding account's linked X handle must be the author of every seeded post. The script is idempotent.

### `PromoV04`

`record-v04.js` records `demo.mp4` (the in-app demo) and `bot-embed.mp4` (the bot beat's plate). It imports the maintainer's own X export, read from the path `REAL_ARCHIVE_SOURCE` names; `gen-archive.js` writes a synthetic archive of the same shape for runs without it. Record one clip with `node record-v04.js bot-embed`.

Two beats take manual X screen recordings:

| Slot file | Used by | Until it exists |
|---|---|---|
| `public/clips/bot-x-capture.mp4` | `PromoV04` bot beat | `BotBeat` renders a mock X card and the bot's reply |
| `public/clips/x-export-capture.mp4` | `FeatureImport` opening | a placeholder card renders |

Drop the file in, run `node gen-clips-manifest.js`, and render again. Any aspect ratio works; 16:9 crops least.

### `PromoV05`

Logged out, one unbroken take of an analyst's public profile. `verifyTarget` refuses to record unless `TARGET_EVENT` carries an archived copy of its source, source media, coordinates and a written proof, and appears in the profile's Recent submissions. To retarget, change `HANDLE`, `COVERAGE_CENTER`, `COVERAGE_ZOOM` and `TARGET_EVENT` in `record-v05.js`.

To give the target event an archived copy, record the snapshot as the owner through `POST /events/{id}/versions` with `source_snapshot_url` set (see [`docs/api.md`](../docs/api.md)). Look the capture up in the Wayback CDX API first (`https://web.archive.org/cdx/search/cdx?url=<source>&output=json&filter=statuscode:200`), and load the replay URL before you record it: the CDX index lists captures the replay layer does not serve.

The intro shows the release from `src/build-version.ts`, which `gen-clips-manifest.js` writes on every render with the resolution order of [`frontend/next.config.mjs`](../frontend/next.config.mjs). Change one and change the other.

### `PromoV05B`

Signed in, one unbroken take of an archive import and a review pass, then the bot plate. Point it at a local instance only. By hand:

```bash
# 1. The fixture: a trimmed copy of the analyst's own export.
backend/.venv/bin/python video/prep-review-take.py \
    --archive "<their export>.zip" --username MPGeoint \
    --creating --threads 14 --out video/out/x-archive-trimmed.zip

# 2. The import worker, in another shell.
make dev-worker

# 3. The take and the render.
cd video
VIDIT_DEMO_PASSWORD=… npm run record:v05b
npm run render:v05b
```

- Run `prep-review-take.py --report` before a shoot. It prints how many detections the export creates, updates and skips, since a re-import of an export the instance already holds creates nothing.
- `POST /events/import-archive/presign` allows 10 calls an hour per account. Past that, the take stalls on *Uploading your archive*.
- The bot plate is `public/clips/bot-embed.mp4`, recorded by `node record-v04.js bot-embed`. `PROMO_BOT_TWEET` overrides the default status in `BOT_EMBED_TWEET`. Without the plate, the take runs straight into the closing card.

### `PromoCollections`

Signed in as the collection's owner, one unbroken take of a collection read and then edited. The take reads the account from `PROMO_LOGIN_EMAIL` and `PROMO_LOGIN_PASSWORD`; set both for a shoot. It prints the event id it added. Remove that event after the render so the next run finds the collection unchanged:

```bash
curl -X DELETE "$API/collections/$COLLECTION/events/$EVENT" \
  -b cookies.txt -H "X-CSRF-Token: $CSRF"
```

`verifyTarget` lists every precondition it checks. To retarget, change `HANDLE`, `TARGET_COLLECTION`, `ADD_QUERY` and `QUERY` in `record-collections.js`; `PROMO_COLLECTION`, `PROMO_ADD_QUERY` and `PROMO_QUERY` override the last three for a shoot.

### `GuideWalkthrough`

The Getting started walkthrough that `/guide` plays at the top of the page: one scene per beat of the page's six sections, about 90 seconds. Signed in, it records two takes, `guide.mp4` at a desktop window and `guide-phone.mp4` at a window under the `sm` breakpoint, so the layout scene shows the phone chip and drawer. Unlike the promos, the comp is cut: each scene is a window of a take between two marks, and the captions and the address bar follow the marks.

The take writes nothing, so you can re-run it against the same instance. It hovers every control that would write (Approve, Request approval, Invite, Follow, the settings switches) and closes every menu and edit state it opens.

Set these before a shoot. None has a default, because every one of them names an account that appears on camera:

| Variable | What it names | What `verifyTargets` checks |
|---|---|---|
| `GUIDE_LOGIN_EMAIL`, `GUIDE_LOGIN_PASSWORD` | The session the take signs in as | The sign-in succeeds |
| `GUIDE_EVENT` | A published event of the session's | Source media, coordinates, an archived copy of the source, a proof of 200 characters or more, at least two versions, and at least one approval on the live version |
| `GUIDE_APPROVE_EVENT` | Another analyst's published event | The session may approve it and has not approved its live version |
| `GUIDE_ORGANIZATION` | An organization slug | It has given at least one approval |
| `GUIDE_FOLLOW_HANDLE` | An analyst to show the Follow control on | It is not the session |

The statuses scene also needs one detected, one geolocated and one requested event of the session's on the first page of `/search?type=event&author=<session>`. Get consent from every analyst the variables name, and record with an account whose feed follows only analysts who agreed.

The settings page opens on the Account card, which shows the session's email address. The take jumps past that card before the settings scene starts and fails if the address is in the window while the scene runs.

```bash
GUIDE_LOGIN_EMAIL=… GUIDE_LOGIN_PASSWORD=… GUIDE_EVENT=… \
GUIDE_APPROVE_EVENT=… GUIDE_ORGANIZATION=… GUIDE_FOLLOW_HANDLE=… \
  make promo-guide
```

Until both takes exist, every scene renders an empty browser window that names the missing file, for its `estimate` in `src/GuideWalkthrough.tsx`, so the composition still previews and renders.

To publish, upload `out/guide-walkthrough.mp4` to the media bucket under `landing/`, the way the landing demo video is hosted, and set the `NEXT_PUBLIC_GUIDE_VIDEO_URL` repo variable to its CloudFront URL. `/guide` renders the player only while that variable is set, and the player loads the file's metadata only until someone presses play.

| To change | Edit |
|---|---|
| Scenes, captions, address bar | `SCENES` in `src/GuideWalkthrough.tsx` |
| Beats, pacing, marks | `record-guide.js` |
| Window sizes | `DESKTOP` and `PHONE` in `record-guide.js`, `CAPTURES` in `src/GuideWalkthrough.tsx` (keep them equal) |

## Getting started screenshots

`/guide` shows annotated screenshots of the product: real captures with a numbered orange disc beside each element a legend line describes. `make guide-shots` runs `shoot-guide.js`, which writes one WebP per shot to `frontend/public/guide/`.

[`frontend/src/app/guide/shots.json`](../frontend/src/app/guide/shots.json) holds every shot. The page reads the same file for its legends, so a marker and its legend line change together.

| Field | What it sets |
|---|---|
| `file` | The WebP under `frontend/public/guide/` |
| `route` | The page to open. `{event}` reads `GUIDE_EVENT`, `{approve_event}` reads `GUIDE_APPROVE_EVENT` |
| `viewport`, `dpr` | The window in CSS pixels and its device pixel ratio |
| `clip` | The captured area, when it is smaller than the window. `x` and `y` offset it from the top left |
| `session` | `signed-in` to sign in first; signed out when absent |
| `markers` | In order: `target` (a Playwright selector), `place` (`left`, `right`, `top-left` or `top-right` of the target's box), and `label` (the legend line) |

A shot that needs a control opened first or a page scrolled (the rail expanded, the phone drawer open, the Notifications card of Settings at the top) gets a step in `PREPARE` in `shoot-guide.js`. The `feed` step switches to **All** when the account follows nobody or the analysts it follows have posted nothing.

Set these before a shoot:

| Variable | What it names |
|---|---|
| `GUIDE_BASE` | The frontend, `http://localhost:3000` by default |
| `GUIDE_API` | The API, `http://localhost:8000/api/v1` by default. Read only for the sign-in |
| `GUIDE_EVENT` | The published geolocation the `event` shot reads. Pick one with source media, an archived source, a proof image and at least one approval |
| `GUIDE_APPROVE_EVENT` | Another analyst's published geolocation the `approvals` shot reads, signed in. Pick one with approvals the account has not given yet, so **Approve** shows |
| `GUIDE_LOGIN_EMAIL`, `GUIDE_LOGIN_PASSWORD` | The account the signed-in shots use. Its username shows in the rail |
| `GUIDE_ONLY` | Optional. A comma-separated list of shot ids to re-shoot |

```bash
GUIDE_EVENT=… make guide-shots
```

To re-shoot only the signed-in shots, read the password into the environment first, so it stays out of your shell history, then run the one-line command:

```bash
read -rs GUIDE_LOGIN_PASSWORD && export GUIDE_LOGIN_PASSWORD
GUIDE_ONLY=layout,layout-phone,approvals,feed,notifications GUIDE_LOGIN_EMAIL=… GUIDE_APPROVE_EVENT=… make guide-shots
```

The script changes no content on the instance: it signs in, opens menus and drawers, and scrolls. It fails when a target is missing and when an email address shows inside a frame, so the Settings shot starts below the Account card. Open every image before you commit it: the shots show the instance's real handles, media and coordinates, so shoot against an instance you are willing to publish. Keep each file under 150 KB.

## Outputs

Each `make` target stages two files off one render:

| File | Shape | Destination |
|---|---|---|
| `*-master.mp4` | the 60 fps render, `+faststart` | S3, played by the landing page's `<video>` |
| `*-readme.mp4` | 1280×720, 30 fps, CRF 26, `+faststart` | a GitHub user-attachment URL for the README |

`make promo` renders `Demo` at `--scale 2` and downscales the master to 2560×1440. The other targets remux the 1080p render without re-encoding.

`make promo-guide` stages a web file in place of the README file: `guide-walkthrough.mp4`, the 1080p render re-encoded at CRF 24 (H.264 high profile, no audio track, `+faststart`) for the player on `/guide`.

### Swap the README embed

1. Drag the new `out/*-readme.mp4` into any GitHub draft comment.
2. Copy the `https://github.com/user-attachments/assets/<uuid>` URL it generates.
3. Replace the URL in the *Demo* section of the root [`README.md`](../README.md). Keep it alone on its own line: that is what triggers GitHub's inline player.

## Shared capture harness

`capture-lib.js` holds what the takes share: the DOM cursor overlay, the chrome the recordings hide (`HIDE_CHROME_INIT`: the version pill, the Next.js dev indicator), the Chrome launcher (`launchChrome`), the motion helpers (`glideAndClick`, `slowScrollToY`, `slowScrollToLocator`, `slowScrollPanel`, `easeCamera`, `dragPan`, `smoothScrollIntoView`, `glideClickStretchedCard`), the mock macOS open dialog (`injectFinder`, `closeFinder`), and `createRecorder`, the frame grabber and encoder. A capture script owns only its storyboard: the pages it visits, what it clicks, and the marks it stamps.

`window.__viditMap` is set by whichever `<Map>` mounted last, so `easeCamera` drives the profile coverage map and the main map with no per-page wiring. It exists in dev builds only.

Two choices shape the harness:

- **A polling `page.screenshot()` grabber instead of Playwright's `recordVideo`.** `recordVideo` caps at 25 fps VP8 and ignores `deviceScaleFactor`. The grabber respects the device pixel ratio and records 2560×1440 frames at up to 60 fps.
- **A DOM cursor overlay.** The OS cursor is not part of the page bitmap that `page.screenshot()` returns, so the harness renders an SVG cursor in the page, driven by the Playwright mouse events.

## Known brittleness

- **Hardcoded posts.** `TWEETS`, `TWEET_URL` and `REQUEST_TWEET_URL` name real posts. If the author deletes one, swap in a post from an analyst who gave permission; the cleanup step and the upload cache key derive from these constants.
- **Live X reads.** `POST /events/import-from-tweet` reads X. When X changes shape, the seeding falls back to an image and logs `video fetch failed; falling back to an image`.
- **Route renames.** The scripts call the live API and click real frontend paths, and no test suite covers them. `check-routes.sh` greps every capture script for retired route spellings; it runs in `make hygiene` and in CI's `hygiene` job. A selector change still needs a capture run to catch.
