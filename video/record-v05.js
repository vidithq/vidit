// v0.5 promo A ("the portfolio"): ONE unbroken take of an analyst's public
// profile, recorded LOGGED OUT against a running instance.
//
//   portfolio.mp4  identity block → the work → the coverage map → one
//                  submission's detail → the general map.
//
// The comp (`src/PromoV05.tsx`) plays this clip as a SINGLE continuous window:
// there is no cut anywhere in the recorded part, so every transition you see
// is motion the browser actually made. That constraint is what shapes this
// file: the take is paced in real time, holds included, and its total length
// IS the promo's recorded length. There is no windowing left to do in the
// comp, so a hold that runs long here runs long on screen.
//
// The two page changes are in-page navigations, never reloads: a click on a
// submission card and a click on the sidebar's Map link, both Next `<Link>`
// pushes. The route swaps under a still camera, so nothing blinks white. A
// silent warm-up pass visits both routes first, so the dev server's
// first-visit compile happens off camera rather than inside a take that
// cannot be cut.
//
// The clip lands in public/clips/ next to the v0.4 takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and the comp reads the marks to time its captions.
//
// Two rules this take enforces, both editorial:
//
//   1. No session. The owner view of a profile carries the account's email
//      address and owner-only chrome (Edit profile, the detections banner,
//      Sign out), none of which belongs in a promo. Recording anonymously is
//      also the honest claim the closing beat makes: the archive reads
//      without an account. Nothing here logs in, submits a form or writes.
//   2. Only the analyst's public page. The analyst named in HANDLE gave
//      consent for their profile to be filmed; the take visits their profile,
//      one of their events, and the public map, and nothing else.
//
// Usage: node record-v05.js        (the instance must already be running)

const fs = require("fs");
const path = require("path");
const {
  wait,
  slowScrollToLocator,
  easeCamera,
  glideAndClick,
  glideClickStretchedCard,
  createRecorder,
} = require("./capture-lib");

const BASE = process.env.PROMO_BASE || "http://localhost:3000";
const API = process.env.PROMO_API || "http://localhost:8000/api/v1";
const FPS = 60;
const CAPTURE_DPR = 2;

// A taller window than a 16:9 laptop, so the opening frame holds the identity
// AND the work: avatar, handle, bio, the counters strip and the Insights card
// all sit above the fold at this height. At 720 the insights fell off the
// bottom and the linked-accounts card was the middle of the frame, which is
// the wrong thumbnail for a portfolio. The comp's browser body matches this
// aspect exactly, so nothing is cropped.
const VIEWPORT = { width: 1280, height: 900 };

const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// The analyst whose public profile the promo films, with their consent.
const HANDLE = "MPGeoint";

// The event the take opens. It has to satisfy three things, and
// `verifyTarget` refuses to record if any of them stops holding:
//   - an archived copy of its SOURCE (`archived_source`), so the detail beat
//     shows the archive affordance doing its job rather than its empty state;
//   - source media, coordinates and a written proof, so the frame carries
//     what the caption claims;
//   - a place in the Recent submissions list the profile renders, since that
//     is the card the cursor clicks.
const TARGET_EVENT = process.env.PROMO_EVENT || "2032501c-3c6c-454b-823b-9621007e5f92";

// Where the coverage beat's camera settles. The profile map opens fitted to
// the analyst's own points, which for a worldwide geolocator is close to a
// world view; the ease walks it in to the densest worked area so "the ground
// you covered" reads as ground rather than as a globe.
const COVERAGE_CENTER = [32, 44];
const COVERAGE_ZOOM = 3.6;

// The general map opens on its default camera; the closing beat pulls back
// from it so the analyst's points sit among everyone else's.
const MAP_PULLBACK_ZOOM = 3.2;

const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
  viewport: VIEWPORT,
});

// ─── preflight ───────────────────────────────────────────────────────────

// Read-only GET against the public API (no cookies): the take never writes.
async function publicGet(pathname) {
  const res = await fetch(`${API}${pathname}`);
  if (!res.ok) throw new Error(`GET ${pathname}: ${res.status}`);
  return res.json();
}

function proofLength(doc) {
  const walk = (n) =>
    (n.text ? n.text.length : 0) + (n.content || []).reduce((a, c) => a + walk(c), 0);
  return doc ? walk(doc) : 0;
}

async function verifyTarget() {
  const event = await publicGet(`/events/${TARGET_EVENT}`);
  const media = (Array.isArray(event.media) ? event.media : [event.media]).filter(Boolean);
  const problems = [];
  if (!media.some((m) => m.role === "source")) problems.push("no source media");
  if (!event.event_coords) problems.push("no coordinates");
  if (proofLength(event.proof) < 200) problems.push("proof too short to read on camera");
  if (!event.source_url) problems.push("no source link");
  // `archived_source` is the copy of the SOURCE link specifically, which is
  // the one the detail beat frames. An event can carry a copy of a secondary
  // source or of the post it was detected from and still show an empty glyph
  // on the Source row, so the other two fields do not qualify it.
  if (!event.archived_source) {
    problems.push(
      "no archived copy of the source, so the detail beat would film the " +
        "archive glyph's empty state (see video/README.md)"
    );
  }
  // The cursor clicks this event's card, so it has to be one the profile
  // actually renders.
  const feed = await publicGet(`/users/${encodeURIComponent(HANDLE)}/events?per_page=5`);
  const listed = (feed.items ?? feed ?? []).some((it) => it.id === TARGET_EVENT);
  if (!listed) problems.push("not in the Recent submissions the profile lists");

  console.log(`→ target: ${event.title}`);
  console.log(`  source ${event.source_url}`);
  console.log(`  archived source: ${JSON.stringify(event.archived_source)}`);
  if (problems.length) {
    throw new Error(
      `event ${TARGET_EVENT} cannot carry the detail beat:\n  - ${problems.join("\n  - ")}`
    );
  }
  return { event };
}

// ─── the take ────────────────────────────────────────────────────────────

const profileUrl = `${BASE}/profile/${HANDLE}`;

async function settleProfile(page) {
  await page.getByRole("heading", { level: 1, name: HANDLE }).waitFor({ timeout: 25000 });
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 25000 });
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas.maplibregl-canvas");
    return c && c.clientWidth > 0 && !!window.__viditMap;
  }, { timeout: 25000 });
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
    .catch(() => {});
}

async function clipPortfolio() {
  await recordClip("portfolio", { cookies: null }, async (page, rec) => {
    const submissions = page.getByRole("heading", { name: "Recent submissions" });
    const coverage = page.getByRole("heading", { name: "Coverage" });
    const details = page.getByRole("heading", { name: "Details" });
    const mapLink = page.locator('aside[aria-label="Primary navigation"] a[href="/map"]');

    // ── warm-up pass (silent) ────────────────────────────────────────────
    // Visit every route the take navigates to, so the dev server's
    // first-visit compile and the basemap tiles are already cached. A
    // compile stall inside an unbroken take cannot be cut out.
    console.log("→ warm-up pass: compile the routes, fill the tile cache");
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await page.goto(`${BASE}/events/${TARGET_EVENT}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Source media" }).waitFor({ timeout: 30000 });
    await wait(1500);
    await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
    await wait(4000);

    // ── the recorded pass, one unbroken session ──────────────────────────
    console.log("→ recorded pass (single continuous take)");
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await wait(2500); // the coverage map's points land and the camera fits
    // The mouse is deliberately never moved until the pin click, so the
    // opening frames carry no cursor: the DOM cursor overlay only paints
    // after a mousemove, and the first frame is a tweet's thumbnail.
    rec.start();

    // 1. The identity block, motionless.
    console.log("→ identity (still)");
    rec.mark("identity");
    await wait(2900);

    // 2. One long eased travel down the page. The linked accounts pass by on
    //    the way, which is where they belong: the counters and the Insights
    //    card are what the travel is going to, and the coverage map is where
    //    it stops.
    console.log("→ travel down to the work");
    rec.mark("work");
    await slowScrollToLocator(page, coverage, 2700, 80);
    await wait(500);

    // 3. The camera walks into the worked area, on the map the page just
    //    scrolled to.
    console.log("→ the coverage map");
    rec.mark("coverage");
    await easeCamera(page, {
      center: COVERAGE_CENTER,
      zoom: COVERAGE_ZOOM,
      durationMs: 1900,
    });
    await wait(400);

    // 4. Carry on down to the submissions and open one. `EntityCard` is a
    //    Next `<Link>`, so the route swaps under the cursor: no reload, no
    //    white flash, the picture never leaves the page.
    console.log("→ down to the submissions, open one");
    rec.mark("submissions");
    await slowScrollToLocator(page, submissions, 1500, 120);
    await wait(600);
    const card = page.locator(`a[href="/events/${TARGET_EVENT}"]`).locator("xpath=..");
    rec.mark("cardClick");
    await glideClickStretchedCard(page, card, TARGET_EVENT);
    await page.waitForURL(`**/events/${TARGET_EVENT}`, { timeout: 25000 });
    // The instant the route actually changed. The comp swaps the faked
    // address bar here, so the chrome never names a page the recording has
    // not reached yet.
    rec.mark("eventUrl");
    await page.getByRole("heading", { name: "Source media" }).waitFor({ timeout: 25000 });
    await page
      .waitForFunction(
        () => {
          const v = document.querySelector("video");
          return !v || v.readyState >= 2;
        },
        { timeout: 15000 }
      )
      .catch(() => {});
    rec.mark("eventOpen");
    await wait(900);

    // 5. The eased scroll takes the frame from the source media past the
    //    point map down to the details, where the coordinates, the source
    //    link with its archived-copy glyph, and the proof all read at once.
    console.log("→ read the event: coordinates, source, archived copy, proof");
    rec.mark("eventScroll");
    await slowScrollToLocator(page, details, 1900, 90);
    await wait(1900);

    // 6. Out to the general map through the sidebar (another in-page push),
    //    then the pull back so the analyst's points join everyone else's.
    console.log("→ out to the general map");
    rec.mark("mapNav");
    await glideAndClick(page, mapLink, { steps: 45, settle: 350 });
    await page.waitForURL("**/map", { timeout: 25000 });
    rec.mark("mapUrl");
    await page.waitForSelector(".maplibregl-canvas", { timeout: 25000 });
    await page.waitForFunction(() => !!window.__viditMap, { timeout: 25000 });
    await wait(1600); // the points fetch lands on the warmed tiles
    rec.mark("mapOpen");
    await easeCamera(page, { zoom: MAP_PULLBACK_ZOOM, durationMs: 2100 });
    await wait(900);
  });
}

(async () => {
  const res = await fetch(`${API}/users/${HANDLE}`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `no public profile for ${HANDLE} at ${API} — is the instance running and imported?`
    );
  }
  await verifyTarget();
  await clipPortfolio();
  console.log("\n✓ portfolio take recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
