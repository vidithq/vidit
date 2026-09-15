// The collections promo: ONE unbroken take of a collection being read and then
// added to, recorded SIGNED IN as the collection's owner against a running
// instance.
//
//   collections.mp4  the profile's Collections shelf → one collection's page,
//                    stepped on the map → its edit page, where a search adds
//                    an event → back to the collection → the profile → the
//                    shelf in search → one query.
//
// The comp (`src/PromoCollections.tsx`) plays this clip as a SINGLE continuous
// window, the rule promo A set: there is no cut anywhere in the recorded part,
// so every transition on screen is motion the browser actually made. The take
// is paced in real time, holds included, and its total length IS the promo's
// recorded length. Re-pace it here, not in the composition.
//
// The page changes are in-page navigations, never reloads: the collection
// card, the Edit control in the collection's header, the save's own return,
// the owner's handle in the byline, the shelf's `Show more` link, and nothing
// else. Each is a Next `<Link>` push or a router push the app performs, so the
// route swaps under a still camera and the picture never blinks white. A
// silent warm-up pass visits every route first, so the dev server's
// first-visit compile happens off camera rather than inside a take that cannot
// be cut.
//
// The clip lands in public/clips/ next to the other takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and the comp reads the marks to time its captions and its address bar.
//
// Two rules this take enforces, both editorial:
//
//   1. The owner's own session. The take signs in as the analyst who owns the
//      collection, through the API, the way record-v04.js mints cookies for
//      its fixture account. That is what puts the Edit control in the header
//      and the edit page behind it on camera, which is the beat the promo is
//      about: a collection is written, not only read.
//   2. Only the analyst's own pages. The analyst named in HANDLE gave consent
//      for their profile to be filmed; the take visits their profile, one of
//      their collections, that collection's edit page, and search scoped to
//      their shelf.
//
// The take WRITES: it puts one event on the collection and saves. Undo it
// after the render (one `DELETE /collections/{id}/events/{event_id}` with the
// same cookies) so the demo collection ends as it started.
//
// Usage: node record-collections.js       (the instance must already be running)

const fs = require("fs");
const path = require("path");
const {
  wait,
  mintCookies,
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

// The dev fixture account the take signs in as: the owner of the collection it
// films. Local preview credentials on this database, overridable for a shoot.
// Nothing prints them and no frame shows them: the sign-in happens through the
// API before the browser opens, so no login form is ever on camera.
const LOGIN_EMAIL = process.env.PROMO_LOGIN_EMAIL || "mpgeoint@gmail.com";
const LOGIN_PASSWORD = process.env.PROMO_LOGIN_PASSWORD || "vidit-dev-preview";

// The capture window is the browser body the comp draws it in, at the CSS size
// that body actually occupies in a 1920x1080 frame.
//
// `PromoCollections.tsx` derives its browser body from a 1080-tall frame minus
// the chrome header, the top margin and the caption band: 830 px tall, and
// 1392 wide at this aspect. Recording at exactly that means the render scales
// the picture by 1 rather than magnifying a smaller window into it, which is
// what read soft. DPR 2 then gives the encode 2784x1660 device px behind those
// 1392x830 CSS px, so the only resampling left is a 2:1 downscale.
//
// The two numbers are a fixed point: BODY_WIDTH = BODY_HEIGHT x (width /
// height) returns 1392 for this pair, so the comp's geometry and this viewport
// agree without either being tuned to the other. Change the caption band or
// the chrome header in the comp and re-derive both.
//
// 1392 keeps the desktop layout: the page's content column caps at `max-w-4xl`
// whatever the window width, and nothing in the collection, profile or search
// surfaces has an `xl` breakpoint, so the layout at 1392 is the layout at
// 1040, with wider gutters. 830 clears the player's `calc(100dvh - 4.5rem)`
// cap on its 32rem block with room to spare, so the player films at the height
// it was designed at.
const VIEWPORT = { width: 1392, height: 830 };

const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// The analyst whose pages the take films, with their consent.
const HANDLE = "MPGeoint";

// The collection the take reads and writes. `verifyTarget` refuses to record
// if it stops carrying what the beats frame.
const TARGET_COLLECTION =
  process.env.PROMO_COLLECTION || "1da4eefa-d712-43d2-be2e-0f6d474d4ba6";

// How many times the beat presses the panel's next control. Two steps is what
// it takes to read the control as a walk rather than as a single move, and the
// pace this cut runs at has no room for a third.
const STEPS = 2;

// The words the edit beat types into the picker's Add events field. They have
// to reach an event of the analyst's that the collection does NOT already
// hold, or the first result answers with a disabled check instead of the add
// control the beat clicks, so `verifyTarget` runs the query before a frame is
// captured.
const ADD_QUERY = process.env.PROMO_ADD_QUERY || "Caracas";

// The query the closing beat types. It has to be a word that actually reaches
// a collection under the scope the take arrives in (this analyst's shelf), so
// `verifyTarget` runs it against the live search before a frame is captured
// rather than letting the last beat film an empty group. Search reads a
// collection's title and description, never the places its events sit in, so a
// city name that every item on the map carries still matches nothing: the
// query has to be words the analyst wrote on the set itself.
const QUERY = process.env.PROMO_QUERY || "Absolute Resolve";

// ─── pacing ──────────────────────────────────────────────────────────────
//
// One cut-down pass: every hold is between 0.8s and 1.5s and every scroll is
// SCROLL_MS, the shortest eased travel that still reads as motion rather than
// as a jump at 60 fps. The take runs 40 to 50 seconds, which is the length the
// promo is cut at, so lengthening a hold here lengthens the video.
const HOLD_SHORT = 1000;
const HOLD = 1100;
const HOLD_LONG = 1500;
const SCROLL_MS = 700;

const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
  viewport: VIEWPORT,
  // The intermediate the comp plays, so it is the ceiling on everything
  // downstream: the final render can only lose what this already threw away.
  // Well below the harness default, which is tuned for takes the comp shrinks.
  crf: 13,
});

// ─── preflight ───────────────────────────────────────────────────────────

let AUTH = null;

// Read the API as the signed-in owner, which is the identity the take records
// under: a check run anonymously would count a different shelf from the one
// the browser is about to show.
async function ownerGet(pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { cookie: AUTH.cookieHeader },
  });
  if (!res.ok) throw new Error(`GET ${pathname}: ${res.status}`);
  return res.json();
}

const searchPath = (params) => `/search?${new URLSearchParams(params).toString()}`;

// The scope the take's last two beats read, built once so the preflight checks
// the same URL the `Show more` link carries.
const SHELF_QUERY = { type: "collection", author: HANDLE };
const SHELF_PATH = searchPath(SHELF_QUERY);

// The picker's own add search, the one the edit beat types into: the analyst's
// own collectable events matching the words, under the two statuses a
// collection may hold (`lib/collections.searchPickableEvents` and
// `COLLECTABLE_STATUSES`, and `PICKER_ROW_LIMIT` for the cap).
function addSearchPath(q) {
  const params = new URLSearchParams({ q, type: "event", author: HANDLE, limit: "5" });
  for (const status of ["geolocated", "detected"]) params.append("status", status);
  return `/search?${params.toString()}`;
}

async function verifyTarget() {
  const me = await ownerGet("/auth/me");
  const collection = await ownerGet(`/collections/${TARGET_COLLECTION}`);
  const problems = [];

  // The whole edit half of the take is owner-only: the header's Edit control,
  // the edit page behind it, and the save. A session that is not the owner's
  // films the page's refusal instead.
  if (me.id !== collection.owner.id) {
    problems.push(
      `signed in as ${me.username}, who does not own the collection (${collection.owner.username} does)`
    );
  }
  if (collection.owner.username !== HANDLE) {
    problems.push(`owned by ${collection.owner.username}, not ${HANDLE}`);
  }
  if (!collection.description) problems.push("no description for the Description card");
  // The panel beat steps `STEPS` times off row 1, so the sequence has to be
  // long enough for every press to land on a real item.
  if (collection.event_count <= STEPS) {
    problems.push(`only ${collection.event_count} events, too few for ${STEPS} steps off the first`);
  }

  // Every item the player flies to needs a point, since the map is half of
  // what the stepping beat shows.
  const sequence = await ownerGet(`/collections/${TARGET_COLLECTION}/events?per_page=100`);
  const items = sequence.items ?? sequence ?? [];
  const unplaced = items.filter((it) => !it.event_coords).length;
  if (unplaced) problems.push(`${unplaced} of ${items.length} items carry no coordinates`);

  // The other half of the stepping beat is the panel, whose head is the
  // Source media block. An item with no media renders `No media available`
  // there, so a sequence holding one films an empty plate on whichever step
  // lands on it.
  const unsourced = items.filter((it) => !it.media).length;
  if (unsourced) problems.push(`${unsourced} of ${items.length} items carry no source media`);

  // The edit beat: the picker's first result is the row the cursor clicks, and
  // it carries the add control only while the collection does not already hold
  // it. A run that was not cleaned up after leaves exactly that row held, so
  // this is the check that catches it.
  const held = new Set(items.map((it) => it.id));
  const addHits = await ownerGet(addSearchPath(ADD_QUERY));
  const firstHit = addHits.geolocations?.[0] ?? null;
  if (!firstHit) {
    problems.push(`"${ADD_QUERY}" matches none of ${HANDLE}'s collectable events`);
  } else if (held.has(firstHit.id)) {
    problems.push(
      `the first "${ADD_QUERY}" result (${firstHit.id}) is already on the collection, so the ` +
        "picker answers it with a disabled check and the add beat has nothing to click"
    );
  }

  // The shelf beat: the profile only grows a `Show more` link once the shelf
  // runs past the four cards the grid holds, and that link is what the take
  // clicks to reach search.
  const shelf = await ownerGet(SHELF_PATH);
  if (shelf.total.collections <= 4) {
    problems.push(
      `${HANDLE} has ${shelf.total.collections} collections, so the profile grid ` +
        "holds them all and renders no Show more link for the take to click"
    );
  }

  // The closing beat: a query that reaches nothing films an empty group under
  // a caption saying search reaches collections.
  const hits = await ownerGet(searchPath({ ...SHELF_QUERY, q: QUERY }));
  if (hits.total.collections < 1) {
    problems.push(`"${QUERY}" matches no collection of ${HANDLE}'s, so the last beat films an empty group`);
  }

  console.log(`→ signed in as ${me.username} (owner)`);
  console.log(`→ collection: ${collection.title} (${collection.event_count} events)`);
  if (firstHit) console.log(`  "${ADD_QUERY}" adds: ${firstHit.title} (${firstHit.id})`);
  console.log(`  shelf: ${shelf.total.collections} collections under ${HANDLE}`);
  console.log(`  "${QUERY}": ${hits.total.collections} collection(s)`);
  if (problems.length) {
    throw new Error(
      `collection ${TARGET_COLLECTION} cannot carry the take:\n  - ${problems.join("\n  - ")}`
    );
  }
  // The narrowed count the closing beat waits for. The shelf it types into
  // already holds cards, so "some cards are on screen" is true before the
  // query commits; the take waits for THIS many instead.
  return {
    collection,
    items,
    addEvent: firstHit,
    heldAfter: items.length + 1,
    queryHits: hits.total.collections,
  };
}

// ─── the take ────────────────────────────────────────────────────────────

const profileUrl = `${BASE}/profile/${HANDLE}`;
const collectionUrl = `${BASE}/collections/${TARGET_COLLECTION}`;
const editUrl = `${collectionUrl}/edit`;
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

// The edit page mounts its form only once the collection's current items have
// landed, so the wait is for the picker's own first card rather than for the
// page: arriving earlier films the loading state under the caption.
async function settleEdit(page) {
  await page.getByRole("heading", { name: "Details" }).waitFor({ timeout: 30000 });
  await page
    .getByRole("heading", { name: "Events in this collection" })
    .waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Add events" }).waitFor({ timeout: 30000 });
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

async function clipCollections({ addEvent, heldAfter, queryHits }) {
  await recordClip("collections", { cookies: AUTH.cookies }, async (page, rec) => {
    const collectionsHeading = page.getByRole("heading", { name: "Collections" });
    const coverage = page.getByRole("heading", { name: "Coverage" });
    const card = page.locator(`a[href="/collections/${TARGET_COLLECTION}"]`);
    const nextStep = page.locator('button[aria-label="Next event"]');
    const editControl = page.locator('a[aria-label="Edit this collection"]');
    const heldHeading = page.getByRole("heading", { name: "Events in this collection" });
    const addField = page.locator('input[type="search"]');
    // The picker answers a held row with a disabled check rather than dropping
    // it, so the add controls are exactly the results that can be added and
    // the first of them is the first result the beat reaches for.
    const addControl = page.locator('button[aria-label^="Add "][aria-label$="to this collection"]');
    const saveButton = page.getByRole("button", { name: "Save collection" });
    // Scoped to the page's own header: signed in, the sidebar carries a link
    // to the same profile, and it stands earlier in the document. The beat is
    // the byline under the collection's title, not the nav row.
    const byline = page.locator(`header a[href="/profile/${HANDLE}"]`).first();
    const showMore = page.locator(`a[href="${SHELF_PATH}"]`);
    const searchField = page.locator('input[type="search"]');

    // ── warm-up pass (silent) ────────────────────────────────────────────
    // Visit every route the take navigates to, so the dev server's
    // first-visit compile and the basemap tiles are already cached. A compile
    // stall inside an unbroken take cannot be cut out.
    console.log("→ warm-up pass: compile the routes, fill the tile cache");
    await page.goto(shelfUrl, { waitUntil: "domcontentloaded" });
    await settleShelf(page);
    await wait(1200);
    await page.goto(editUrl, { waitUntil: "domcontentloaded" });
    await settleEdit(page);
    // The picker's typed half is its own endpoint and its own compile, so the
    // warm-up runs the query the beat types rather than only opening the page.
    await addField.click();
    await page.keyboard.type(ADD_QUERY, { delay: 20 });
    await addControl.first().waitFor({ timeout: 30000 });
    await wait(800);
    await page.goto(collectionUrl, { waitUntil: "domcontentloaded" });
    await settleCollection(page);
    await wait(2500);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await wait(2000);

    // ── the recorded pass, one unbroken session ──────────────────────────
    console.log("→ recorded pass (single continuous take)");
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await settleProfile(page);
    await wait(1500); // the covers land before the first frame
    rec.start();

    // 1. The shelf on the profile. The section sits between Insights and
    //    Recent submissions, so the take scrolls onto it rather than opening
    //    there, and the scroll is what says where a collection lives.
    console.log("→ the profile's Collections shelf");
    rec.mark("shelf");
    await wait(HOLD_SHORT);
    // The opening scroll is the one the viewer reads the page by, so it runs
    // at twice the pace of every later scroll.
    await slowScrollToLocator(page, collectionsHeading, SCROLL_MS * 2, 60);
    await wait(HOLD_SHORT);

    // 2. One card, hovered. The mosaic, the title, the count and the date
    //    span are the whole of what a collection promises before it is
    //    opened, and the hover is what marks the card as the thing about to
    //    be clicked.
    console.log("→ hover the collection card");
    rec.mark("cardHover");
    await glideHover(page, card, { steps: 34, hold: HOLD });

    // 3. Open it. `CollectionCard` covers itself with a stretched `<Link>`,
    //    so the route swaps under the cursor: no reload, no white flash.
    console.log("→ open the collection");
    rec.mark("cardClick");
    await glideAndClick(page, card, { steps: 18, settle: 300 });
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

    // 4. The page as it opens. At this window height one frame already holds
    //    the whole of it: the title, the owner's byline, the Collection pill
    //    and the meta line, the Description card, and the player under them at
    //    step 1. Nothing is scrolled for, which is the point of the height.
    await wait(HOLD_LONG);

    // 5. The walk. Each press flies the map to the next item, dims the step
    //    behind it and swaps the panel, and the header counts it. The holds
    //    are a little longer than the 900ms flight, so what lands is read.
    console.log(`→ step ${STEPS} times`);
    rec.mark("step");
    for (let i = 0; i < STEPS; i++) {
      await glideAndClick(page, nextStep, { steps: i === 0 ? 30 : 6, settle: 220 });
      await wait(1300);
    }

    // 6. The Edit control in the page's own header, which exists because the
    //    take is signed in as the owner. Another in-page push.
    console.log("→ open the edit page");
    rec.mark("editClick");
    await glideAndClick(page, editControl, { steps: 34, settle: 350 });
    await page.waitForURL("**/edit", { timeout: 30000 });
    rec.mark("editUrl");
    await settleEdit(page);
    rec.mark("editOpen");

    // 7. The page as it opens: Details, with the title and the description the
    //    collection reads under, and the head of `Events in this collection`,
    //    which is what the collection will hold if it is saved now.
    await wait(HOLD_LONG);
    await slowScrollToLocator(page, heldHeading, SCROLL_MS, 90);
    await wait(HOLD);

    // 8. The Add events card, and the search that is the way into it. The
    //    field answers on a debounce rather than on a key, so the take waits
    //    for the rows rather than for the typing to finish.
    console.log(`→ type "${ADD_QUERY}" into the picker`);
    rec.mark("addQuery");
    await slowScrollToLocator(page, addField, SCROLL_MS, 260);
    await glideAndClick(page, addField, { steps: 28, settle: 300 });
    await page.keyboard.type(ADD_QUERY, { delay: 70 });
    await addControl.first().waitFor({ timeout: 20000 });
    await wait(HOLD_LONG);

    // 9. The add control on the first result. The row does not leave the card:
    //    its control becomes the disabled check that says the collection holds
    //    it now, which is the feedback in frame.
    console.log(`→ add ${addEvent.title}`);
    rec.mark("addClick");
    await glideAndClick(page, addControl.first(), { steps: 30, settle: 300 });
    await wait(HOLD);

    // 10. Save, past the three cards where the page puts its action row. The
    //     save writes the details and the one membership the picker moved,
    //     then returns to the collection itself.
    console.log("→ save");
    await slowScrollToLocator(page, saveButton, SCROLL_MS, 520);
    await wait(HOLD_SHORT);
    rec.mark("saveClick");
    await glideAndClick(page, saveButton, { steps: 30, settle: 300 });
    await page.waitForURL(`**/collections/${TARGET_COLLECTION}`, { timeout: 30000 });
    rec.mark("savedUrl");
    await settleCollection(page);
    // The count in the meta line under the title, and the `N of M` in the
    // player's header, are both what the save just changed, so the take waits
    // for the new figure rather than for the page: arriving on the old one
    // films the add not having happened.
    await page.waitForFunction(
      (n) => document.body.innerText.includes(`${n} events`),
      heldAfter,
      { timeout: 20000 }
    );
    rec.mark("saved");
    await wait(HOLD_LONG);

    // 11. Back to the owner, through the byline under the title. Another
    //     in-page push, so the profile arrives without a reload.
    console.log("→ back to the profile through the byline");
    await slowScrollToY(page, 0, 500);
    rec.mark("bylineClick");
    await glideAndClick(page, byline, { steps: 30, settle: 300 });
    await page.waitForURL(`**/profile/${HANDLE}`, { timeout: 30000 });
    rec.mark("profileUrl");
    await settleProfile(page);
    await wait(HOLD_SHORT);

    // 12. The shelf again, and the link under it. The grid holds four cards
    //     and `Show more` is where the whole of it is walked.
    console.log("→ the Show more link under the shelf");
    await slowScrollToLocator(page, showMore, SCROLL_MS, 420);
    await wait(HOLD_SHORT);
    rec.mark("showMore");
    await glideAndClick(page, showMore, { steps: 30, settle: 300 });
    await page.waitForURL("**/search**", { timeout: 30000 });
    rec.mark("searchUrl");
    await settleShelf(page);
    rec.mark("searchOpen");
    // The whole shelf, scoped by the Author filter the link carried: the same
    // cards the profile previewed, with the count beside the group's name.
    await wait(HOLD_LONG);

    // 13. One query, typed into the field the page opens focused. The scope
    //     and the author filter stay on, so what narrows is the shelf itself,
    //     which is the claim the closing caption makes.
    console.log(`→ type "${QUERY}"`);
    rec.mark("query");
    await glideAndClick(page, searchField, { steps: 26, settle: 300 });
    await page.keyboard.type(QUERY, { delay: 70 });
    await page.keyboard.press("Enter");
    // The field commits on a debounce rather than on the key, so the wait is
    // for the result rather than for the press. It waits for the exact number
    // of cards the preflight counted: the URL carries `q` before the list is
    // refetched, so a wait on the address alone can release while the whole
    // unnarrowed shelf is still on screen, under a caption saying it narrowed.
    await page.waitForFunction(
      ({ q, hits }) => {
        const cards = document.querySelectorAll('a[href^="/collections/"]');
        return cards.length === hits && new URL(location.href).searchParams.get("q") === q;
      },
      { q: QUERY, hits: queryHits },
      { timeout: 20000 }
    );
    rec.mark("queryResult");
    // The shot's own end rather than a pause between beats: the narrowed shelf
    // holds while the comp crossfades out of it.
    await wait(3000);
  });
}

(async () => {
  const res = await fetch(`${API}/users/${HANDLE}`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `no public profile for ${HANDLE} at ${API}. Is the instance running and imported?`
    );
  }
  AUTH = await mintCookies(API, LOGIN_EMAIL, LOGIN_PASSWORD);
  const target = await verifyTarget();
  await clipCollections(target);
  console.log("\n✓ collections take recorded");
  console.log(
    `\n! the take put ${target.addEvent.id} on the collection. Undo it after the render:\n` +
      `  DELETE ${API}/collections/${TARGET_COLLECTION}/events/${target.addEvent.id}`
  );
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
