// v0.5 promo A ("the portfolio"): one continuous take of an analyst's public
// profile, recorded LOGGED OUT against a running instance.
//
//   portfolio.mp4  identity block → recent submissions → coverage map →
//                  one event's detail (source, coordinates, proof) → the
//                  general map.
//
// The clip lands in public/clips/ next to the v0.4 takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and `src/PromoV05.tsx` windows the beats out of them.
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

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const FPS = 60;
const CAPTURE_DPR = 2;
const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// The analyst whose public profile the promo films, with their consent.
const HANDLE = "MPGeoint";

// Where the coverage beat's camera settles. The profile map opens fitted to
// the analyst's own points, which for a worldwide geolocator is close to a
// world view; the ease then walks in to the densest worked area so "the
// ground you covered" reads as ground rather than as a globe. Retarget this
// when the promo switches analyst.
const COVERAGE_CENTER = [30, 42];
const COVERAGE_ZOOM = 3.3;

// The general map opens on its default camera; the closing beat pulls back
// from it so the analyst's points sit among everyone else's.
const MAP_PULLBACK_ZOOM = 3.2;

const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
});

// ─── the event the take opens ────────────────────────────────────────────

// Read-only GET against the public API (no cookies): the take never writes.
async function publicGet(pathname) {
  const res = await fetch(`${API}${pathname}`);
  if (!res.ok) throw new Error(`GET ${pathname}: ${res.status}`);
  return res.json();
}

function mediaList(event) {
  const m = event.media;
  if (!m) return [];
  return (Array.isArray(m) ? m : [m]).filter(Boolean);
}

function proofLength(event) {
  // The proof is a Tiptap doc; measure the text it actually carries so an
  // empty document doesn't pass for a written proof.
  const walk = (node) =>
    (node.text ? node.text.length : 0) +
    (node.content || []).reduce((acc, c) => acc + walk(c), 0);
  return event.proof ? walk(event.proof) : 0;
}

// The detail beat needs a card that shows all four things the caption
// promises: source media, coordinates, a written proof, and a source link
// (whose archived-copy glyph sits beside it). Walk the cards the profile
// actually renders, newest first, and take the first that qualifies.
async function pickDetailEvent(hrefs) {
  for (const href of hrefs) {
    const id = href.split("/").pop();
    let event;
    try {
      event = await publicGet(`/events/${id}`);
    } catch {
      continue;
    }
    const media = mediaList(event);
    const ok =
      media.some((x) => x.role === "source") &&
      event.event_coords &&
      proofLength(event) > 80 &&
      !!event.source_url &&
      !event.is_graphic;
    console.log(
      `  candidate ${id.slice(0, 8)} media=${media.length} proof=${proofLength(event)} ` +
        `source=${event.source_url ? "yes" : "no"} archived=${event.archived_copies ? "yes" : "no"}` +
        (ok ? "  ← chosen" : "")
    );
    if (ok) {
      if (!event.archived_copies) {
        console.log(
          "  ! the chosen event has no archived copy of its source, so the " +
            "archive glyph films in its empty state (see video/README.md)"
        );
      }
      return { id, event };
    }
  }
  throw new Error("no recent submission carries source media + coordinates + proof");
}

// ─── the take ────────────────────────────────────────────────────────────

const profileUrl = `${BASE}/profile/${HANDLE}`;

async function openProfile(page) {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: HANDLE }).waitFor({ timeout: 20000 });
  // The coverage map is WebGL and mounts after its points fetch; wait for the
  // canvas AND the dev camera handle, then let tiles and pins settle.
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 20000 });
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas.maplibregl-canvas");
    return c && c.clientWidth > 0 && !!window.__viditMap;
  }, { timeout: 20000 });
  await page.waitForFunction(
    () => [...document.images].every((i) => i.complete),
    { timeout: 20000 }
  ).catch(() => {});
  await wait(4000);
}

async function clipPortfolio() {
  await recordClip("portfolio", { cookies: null }, async (page, rec) => {
    const submissionsHeading = page.getByRole("heading", { name: "Recent submissions" });
    const coverageHeading = page.getByRole("heading", { name: "Coverage" });

    // ── setup pass (silent) ──────────────────────────────────────────────
    // Choose the event to open, and warm the two routes the take navigates
    // to: the dev server compiles a route on first visit, and a compile
    // stall inside a recorded beat reads as the product being slow.
    console.log("→ setup pass: pick the detail event, warm the routes");
    await openProfile(page);
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/events/"]')].map((a) => a.getAttribute("href"))
    );
    if (!hrefs.length) throw new Error(`no recent submissions on /profile/${HANDLE}`);
    const { id: TARGET, event } = await pickDetailEvent(hrefs);
    console.log(`  detail event: ${TARGET} — ${event.title}`);

    await page.goto(`${BASE}/events/${TARGET}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Source media" }).waitFor({ timeout: 25000 });
    await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 25000 });
    await wait(2500);

    // ── recorded pass ────────────────────────────────────────────────────
    console.log("→ recorded pass");
    await openProfile(page);
    // The mouse is deliberately never moved before the click beat: the DOM
    // cursor overlay only paints after a mousemove, so the opening frames
    // (the tweet's thumbnail) carry no cursor at all.
    rec.start();

    // 1. The identity block, motionless. No scroll, no cursor, no camera.
    console.log("→ identity block (still)");
    rec.mark("identity");
    await wait(4600);

    // 2. Short scroll down to Recent submissions, thumbnails on camera.
    console.log("→ scroll to Recent submissions");
    rec.mark("submissions");
    await slowScrollToLocator(page, submissionsHeading, 1700, 130);
    await wait(3000);

    // 3. Back up to the coverage map, then the camera walks into the worked
    //    area. The profile map is the same <Map> as /map, so the shared
    //    easeCamera handle drives it.
    console.log("→ coverage map");
    await slowScrollToLocator(page, coverageHeading, 1300, 80);
    await wait(1000);
    rec.mark("coverageHold");
    await wait(1200);
    rec.mark("coverageEase");
    await easeCamera(page, {
      center: COVERAGE_CENTER,
      zoom: COVERAGE_ZOOM,
      durationMs: 2400,
    });
    await wait(1100);

    // 4. Open one submission. The cut lands on the recorded click, so the
    //    beat junction is the navigation itself.
    console.log("→ open a submission");
    const card = page.locator(`a[href="/events/${TARGET}"]`).locator("xpath=..");
    await slowScrollToLocator(page, card, 1400, 210);
    await wait(700);
    rec.mark("cardApproach");
    await glideClickStretchedCard(page, card, TARGET);
    // Stamped immediately after the click, so the comp can end the profile
    // half of the beat ON the click instead of guessing how long the glide
    // and the navigation took.
    rec.mark("cardClicked");
    await page.waitForURL(`**/events/${TARGET}`, { timeout: 25000 });
    await page.getByRole("heading", { name: "Source media" }).waitFor({ timeout: 25000 });
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video");
        return !v || v.readyState >= 2;
      },
      { timeout: 20000 }
    ).catch(() => {});
    await wait(500);
    rec.mark("eventOpen");
    await wait(1100);

    // The eased scroll takes the frame from the source media past the point
    // map down to the details, where the coordinates, the source link with
    // its archived-copy glyph, and the proof all read at once.
    console.log("→ scroll the detail: coordinates, source, proof");
    rec.mark("eventScroll");
    await slowScrollToLocator(page, page.getByRole("heading", { name: "Details" }), 1900, 100);
    await wait(2400);

    // 5. Back to the general map through the sidebar, then pull back so the
    //    analyst's points sit among everyone else's.
    console.log("→ the general map");
    rec.mark("mapNav");
    await glideAndClick(
      page,
      page.locator('aside[aria-label="Primary navigation"] a[href="/map"]')
    );
    await page.waitForURL("**/map", { timeout: 25000 });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 25000 });
    await page.waitForFunction(() => !!window.__viditMap, { timeout: 25000 });
    await wait(3200); // tiles + the points fetch settle
    rec.mark("mapOpen");
    await wait(1200);
    rec.mark("mapEase");
    await easeCamera(page, { zoom: MAP_PULLBACK_ZOOM, durationMs: 2200 });
    await wait(1400);
  });
}

(async () => {
  const res = await fetch(`${API}/users/${HANDLE}`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `no public profile for ${HANDLE} at ${API} — is the instance running and imported?`
    );
  }
  await clipPortfolio();
  console.log("\n✓ portfolio take recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
