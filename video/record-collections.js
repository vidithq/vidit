// The collections promo: ONE unbroken take of a collection being read,
// recorded LOGGED OUT against a running instance.
//
//   collections.mp4  the profile's Collections shelf → one collection's page,
//                    stepped on the map → the events list → back to the
//                    profile → the shelf in search → one query.
//
// The comp (`src/PromoCollections.tsx`) plays this clip as a SINGLE continuous
// window, the rule promo A set: there is no cut anywhere in the recorded part,
// so every transition on screen is motion the browser actually made. The take
// is paced in real time, holds included, and its total length IS the promo's
// recorded length. Re-pace it here, not in the composition.
//
// The four page changes are in-page navigations, never reloads: the collection
// card, the owner's handle in the byline, the shelf's `Show more` link, and
// nothing else. Each is a Next `<Link>` push, so the route swaps under a still
// camera and the picture never blinks white. A silent warm-up pass visits
// every route first, so the dev server's first-visit compile happens off
// camera rather than inside a take that cannot be cut.
//
// The clip lands in public/clips/ next to the other takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and the comp reads the marks to time its captions and its address bar.
//
// Two rules this take enforces, both editorial and both promo A's:
//
//   1. No session. A collection reads the same signed out, which is the claim
//      the take makes by recording it that way. Nothing here logs in, submits
//      a form or writes. The owner's own controls (Edit, Drop, the picker) are
//      not part of the film because they are not part of the visitor's page.
//   2. Only the analyst's public pages. The analyst named in HANDLE gave
//      consent for their profile to be filmed; the take visits their profile,
//      one of their collections, and search scoped to their shelf.
//
// Usage: node record-collections.js       (the instance must already be running)

const fs = require("fs");
const path = require("path");
const {
  wait,
  slowScrollToY,
  slowScrollToLocator,
  glideHover,
  glideAndClick,
  createRecorder,
} = require("./capture-lib");

const BASE = process.env.PROMO_BASE || "http://localhost:3000";
const API = process.env.PROMO_API || "http://localhost:8000/api/v1";
const FPS = 60;
const CAPTURE_DPR = 2;

// A short, wide window, the geometry promo A chose and this take inherits with
// one number changed.
//
// 1040 wide keeps the desktop layout (above Tailwind's `lg`) with the content
// column at its 848 CSS px cap, so a wider capture would only add dark
// gutters. What magnifies the page in the comp is a SHORT capture, since the
// on-screen column works out to (comp body height) x (848 / capture height).
//
// 620 tall rather than promo A's 560, and the collection page's player is what
// decides it. The player is a fixed 32rem block from `sm` up, held under
// `calc(100dvh - 4.5rem)`: at 560 that cap bites and the map and the panel are
// filmed 24px shorter than a reader sees them, and the Description card above
// has nowhere to sit. At 620 the cap clears the block, so the take films the
// player at the height it was designed at, and the card under the page header
// still fits in the same frame as the player's head.
//
// So 620 is a landmark rather than a constant: it is the first height at which
// the player is unclamped. If the block's 32rem or the page header's height
// moves, re-measure it rather than trusting the number.
//
// The comp's browser body matches this aspect exactly, so nothing is cropped.
// Change one and change `CAPTURE` in src/PromoCollections.tsx.
const VIEWPORT = { width: 1040, height: 620 };

const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// The analyst whose public pages the take films, with their consent.
const HANDLE = "MPGeoint";

// The collection the take reads. `verifyTarget` refuses to record if it stops
// carrying what the beats frame.
const TARGET_COLLECTION =
  process.env.PROMO_COLLECTION || "1da4eefa-d712-43d2-be2e-0f6d474d4ba6";

// Which row the list beat opens. Far enough down the list that the step it
// lands on is plainly not the next one, which is the point of the beat: the
// list is the index of the walk, not a second next button.
const ROW_STEP = 8;

// How many times the beat presses the panel's next control. Three steps is
// what it takes to read the control as a walk rather than as a single move.
const STEPS = 3;

// The query the closing beat types. It has to be a word that actually reaches
// a collection under the scope the take arrives in (this analyst's shelf), so
// `verifyTarget` runs it against the live search before a frame is captured
// rather than letting the last beat film an empty group.
const QUERY = process.env.PROMO_QUERY || "Higuerote";

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

const searchPath = (params) => `/search?${new URLSearchParams(params).toString()}`;

// The scope the take's last two beats read, built once so the preflight checks
// the same URL the `Show more` link carries.
const SHELF_QUERY = { type: "collection", author: HANDLE };
const SHELF_PATH = searchPath(SHELF_QUERY);

async function verifyTarget() {
  const collection = await publicGet(`/collections/${TARGET_COLLECTION}`);
  const problems = [];

  if (collection.owner.username !== HANDLE) {
    problems.push(`owned by ${collection.owner.username}, not ${HANDLE}`);
  }
  if (!collection.description) problems.push("no description for the Description card");
  // The list beat opens row `ROW_STEP` and the panel beat steps `STEPS` times
  // off row 1, so the sequence has to be long enough for both to land on a
  // real item.
  if (collection.event_count <= Math.max(ROW_STEP, STEPS + 1)) {
    problems.push(
      `only ${collection.event_count} events, too few for step ${ROW_STEP} and ` +
        `${STEPS} steps off the first`
    );
  }

  // Every item the player flies to needs a point, since the map is half of
  // what the stepping beat shows.
  const sequence = await publicGet(`/collections/${TARGET_COLLECTION}/events?per_page=100`);
  const items = sequence.items ?? sequence ?? [];
  const unplaced = items.filter((it) => !it.event_coords).length;
  if (unplaced) problems.push(`${unplaced} of ${items.length} items carry no coordinates`);

  // The shelf beat: the profile only grows a `Show more` link once the shelf
  // runs past the four cards the grid holds, and that link is what the take
  // clicks to reach search.
  const shelf = await publicGet(SHELF_PATH);
  if (shelf.total.collections <= 4) {
    problems.push(
      `${HANDLE} has ${shelf.total.collections} collections, so the profile grid ` +
        "holds them all and renders no Show more link for the take to click"
    );
  }

  // The closing beat: a query that reaches nothing films an empty group under
  // a caption saying search reaches collections.
  const hits = await publicGet(searchPath({ ...SHELF_QUERY, q: QUERY }));
  if (hits.total.collections < 1) {
    problems.push(`"${QUERY}" matches no collection of ${HANDLE}'s, so the last beat films an empty group`);
  }

  console.log(`→ collection: ${collection.title} (${collection.event_count} events)`);
  console.log(`  shelf: ${shelf.total.collections} collections under ${HANDLE}`);
  console.log(`  "${QUERY}": ${hits.total.collections} collection(s)`);
  if (problems.length) {
    throw new Error(
      `collection ${TARGET_COLLECTION} cannot carry the take:\n  - ${problems.join("\n  - ")}`
    );
  }
  return { collection, items };
}

// ─── the take ────────────────────────────────────────────────────────────

const profileUrl = `${BASE}/profile/${HANDLE}`;
const collectionUrl = `${BASE}/collections/${TARGET_COLLECTION}`;
const shelfUrl = `${BASE}${SHELF_PATH}`;

// The profile's Collections section is a client read that renders nothing
// until it lands, so every arrival on the profile waits for the heading rather
// than for the page.
async function settleProfile(page) {
  await page.getByRole("heading", { level: 1, name: HANDLE }).waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Collections" }).waitFor({ timeout: 30000 });
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
    .catch(() => {});
}

async function settleCollection(page) {
  await page.getByRole("heading", { name: "Coverage" }).waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Events" }).waitFor({ timeout: 30000 });
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas.maplibregl-canvas");
      return c && c.clientWidth > 0 && !!window.__viditMap;
    },
    { timeout: 30000 }
  );
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
    .catch(() => {});
}

async function settleShelf(page) {
  await page.getByRole("heading", { level: 1, name: "Search" }).waitFor({ timeout: 30000 });
  await page
    .locator(`a[href^="/collections/"]`)
    .first()
    .waitFor({ timeout: 30000 });
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
    .catch(() => {});
}

async function clipCollections() {
  await recordClip("collections", { cookies: null }, async (page, rec) => {
    const collectionsHeading = page.getByRole("heading", { name: "Collections" });
    const coverage = page.getByRole("heading", { name: "Coverage" });
    const eventsHeading = page.getByRole("heading", { name: "Events" });
    const card = page.locator(`a[href="/collections/${TARGET_COLLECTION}"]`);
    const nextStep = page.locator('button[aria-label="Next event"]');
    const rows = page.locator('button[aria-label^="Read this collection from"]');
    const byline = page.locator(`a[href="/profile/${HANDLE}"]`).first();
    const showMore = page.locator(`a[href="${SHELF_PATH}"]`);
    const searchField = page.locator('input[type="search"]');

    // ── warm-up pass (silent) ────────────────────────────────────────────
    // Visit every route the take navigates to, so the dev server's
    // first-visit compile and the basemap tiles are already cached. A compile
    // stall inside an unbroken take cannot be cut out.
    console.log("→ warm-up pass: compile the routes, fill the tile cache");
    await page.goto(shelfUrl, { waitUntil: "domcontentloaded" });
    await settleShelf(page);
    await wait(1500);
    await page.goto(collectionUrl, { waitUntil: "domcontentloaded" });
    await settleCollection(page);
    await wait(3000);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await wait(2500);

    // ── the recorded pass, one unbroken session ──────────────────────────
    console.log("→ recorded pass (single continuous take)");
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await wait(2000); // the covers land before the first frame
    rec.start();

    // 1. The shelf on the profile. The section sits between Insights and
    //    Recent submissions, so the take scrolls onto it rather than opening
    //    there, and the scroll is what says where a collection lives.
    console.log("→ the profile's Collections shelf");
    rec.mark("shelf");
    await wait(1500);
    await slowScrollToLocator(page, collectionsHeading, 2300, 60);
    await wait(1600);

    // 2. One card, hovered. The mosaic, the title, the count and the date
    //    span are the whole of what a collection promises before it is
    //    opened, and the hover is what marks the card as the thing about to
    //    be clicked.
    console.log("→ hover the collection card");
    rec.mark("cardHover");
    await glideHover(page, card, { steps: 55, hold: 1900 });

    // 3. Open it. `CollectionCard` covers itself with a stretched `<Link>`,
    //    so the route swaps under the cursor: no reload, no white flash.
    console.log("→ open the collection");
    rec.mark("cardClick");
    await glideAndClick(page, card, { steps: 30, settle: 400 });
    await page.waitForURL(`**/collections/${TARGET_COLLECTION}**`, { timeout: 30000 });
    // The instant the route actually changed. The comp swaps the faked address
    // bar here, so the chrome never names a page the recording has not reached.
    rec.mark("collectionUrl");
    const tCol = Date.now();
    await settleCollection(page);
    // Logged because this is the wait that can silently stretch the take: the
    // page reads the collection and its whole sequence before the map can be
    // framed on the set.
    console.log(`  · collection page settled after ${Date.now() - tCol}ms`);
    rec.mark("collectionOpen");

    // 4. The page as it opens: the title, the owner's byline, the Collection
    //    pill and the meta line, then the Description card, which is where the
    //    analyst says what the set holds. The player's head is already under
    //    it, at step 1 of the sequence.
    await wait(2600);

    // 5. Down to the player, which the frame now holds whole: the sequence on
    //    the map, and the current item in the map page's own panel beside it.
    console.log("→ frame the player");
    rec.mark("player");
    await slowScrollToLocator(page, coverage, 1500, 40);
    await wait(1800);

    // 6. The walk. Each press flies the map to the next item, dims the step
    //    behind it and swaps the panel, and the header counts it. The holds
    //    are longer than the 900ms flight on purpose: the beat is about what
    //    lands, not about the motion.
    console.log(`→ step ${STEPS} times`);
    rec.mark("step");
    for (let i = 0; i < STEPS; i++) {
      await glideAndClick(page, nextStep, { steps: i === 0 ? 45 : 8, settle: 250 });
      await wait(2000);
    }

    // 7. The list under the player, which is the same sequence written out and
    //    the player's step control: a click on a row moves the walk to it.
    console.log("→ down to the events list");
    rec.mark("events");
    await slowScrollToLocator(page, eventsHeading, 1800, 70);
    await wait(1500);

    // 8. A row far enough down that the step it takes is plainly a jump. The
    //    row lights on the click, which is the feedback in frame; the map
    //    flies to it off screen, and the scroll back up is what shows where it
    //    landed.
    console.log(`→ open row ${ROW_STEP}`);
    const row = rows.nth(ROW_STEP - 1);
    await slowScrollToLocator(page, row, 1300, 300);
    rec.mark("rowClick");
    await glideAndClick(page, row, { steps: 45, settle: 500 });
    await wait(1400);

    // 9. Back up to the player, now standing on the row the list picked: the
    //    map on that point, the steps behind it dimmed, and the header
    //    counting the jump.
    console.log("→ back up to the player");
    rec.mark("rowLanded");
    await slowScrollToLocator(page, coverage, 2000, 40);
    await wait(2600);

    // 10. Back to the owner, through the byline under the title. Another
    //     in-page push, so the profile arrives without a reload.
    console.log("→ back to the profile through the byline");
    await slowScrollToY(page, 0, 1400);
    await wait(700);
    rec.mark("bylineClick");
    await glideAndClick(page, byline, { steps: 45, settle: 450 });
    await page.waitForURL(`**/profile/${HANDLE}`, { timeout: 30000 });
    rec.mark("profileUrl");
    await settleProfile(page);
    await wait(1200);

    // 11. The shelf again, and the link under it. The grid holds four cards
    //     and `Show more` is where the whole of it is walked.
    console.log("→ the Show more link under the shelf");
    await slowScrollToLocator(page, showMore, 2200, 420);
    await wait(1400);
    rec.mark("showMore");
    await glideAndClick(page, showMore, { steps: 45, settle: 450 });
    await page.waitForURL("**/search**", { timeout: 30000 });
    rec.mark("searchUrl");
    await settleShelf(page);
    rec.mark("searchOpen");
    // The whole shelf, scoped by the Author filter the link carried: the same
    // cards the profile previewed, with the count beside the group's name.
    await wait(3000);

    // 12. One query, typed into the field the page opens focused. The scope
    //     and the author filter stay on, so what narrows is the shelf itself,
    //     which is the claim the closing caption makes.
    console.log(`→ type "${QUERY}"`);
    rec.mark("query");
    await glideAndClick(page, searchField, { steps: 40, settle: 400 });
    await page.keyboard.type(QUERY, { delay: 110 });
    await page.keyboard.press("Enter");
    // The field commits on a debounce rather than on the key, so the wait is
    // for the result rather than for the press.
    await page.waitForFunction(
      (q) => {
        const cards = document.querySelectorAll('a[href^="/collections/"]');
        return cards.length > 0 && cards.length < 6 && new URL(location.href).searchParams.get("q") === q;
      },
      QUERY,
      { timeout: 20000 }
    );
    rec.mark("queryResult");
    await wait(3400);
  });
}

(async () => {
  const res = await fetch(`${API}/users/${HANDLE}`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `no public profile for ${HANDLE} at ${API}. Is the instance running and imported?`
    );
  }
  await verifyTarget();
  await clipCollections();
  console.log("\n✓ collections take recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
