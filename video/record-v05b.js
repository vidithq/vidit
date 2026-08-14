// v0.5 promo B ("import and review"): ONE continuous signed-in take of the
// archive import and the review pass, recorded against a running instance.
//
//   import-review.mp4  the bulk-import panel -> the archive picker -> the
//                      progress steps -> the detections queue with its
//                      readiness filter -> one draft opened in the review pass
//                      -> submit -> the next draft -> the map.
//
// The clip lands in public/clips/ next to the other takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and `src/PromoV05B.tsx` windows the beats out of them.
//
// What this take may and may not film, and why the fixture is what it is:
//
//   1. One analyst's archive only. The account it signs into is the analyst
//      who consented to appear in the promo, and the export it imports is
//      that same analyst's own. No other export on this machine is filmed,
//      and no post is ever attributed to an account other than its author.
//   2. The import creates for real. Since v0.5.2 an import updates the drafts
//      it already produced instead of duplicating them, so re-importing an
//      export the instance already holds creates nothing. Rather than stage a
//      fake creation, the take imports a TRIMMED copy of the same analyst's
//      export (`prep-review-take.py` writes it, and prints exactly how many
//      detections it will create, update and skip). Trimming is what the
//      import panel itself recommends, and it keeps the import inside one
//      take. What the Done step reports is the true count.
//   3. The queue was not emptied first. The instance already carries several
//      hundred machine drafts, all of them produced by importing this same
//      analyst's archive, and the take films that queue as it stands. No
//      caption claims the import filled it.
//   4. The submit is a real submit. It publishes one of the analyst's own
//      drafts on the LOCAL instance, with a conflict that matches the draft's
//      own coordinates and `Unknown` as the capture source, which asserts
//      nothing the draft does not carry.
//
// Prerequisites:
//   - the instance running on :3000 / :8000, with the analyst's account on it
//   - VIDIT_DEMO_PASSWORD set to that account's local password
//   - video/out/x-archive-trimmed.zip written by prep-review-take.py
//
// Usage: VIDIT_DEMO_PASSWORD=… node record-v05b.js

const fs = require("fs");
const path = require("path");
const {
  wait,
  mintCookies,
  apiCall,
  glideAndClick,
  slowScrollToY,
  slowScrollToLocator,
  smoothScrollIntoView,
  glideClickStretchedCard,
  easeCamera,
  injectFinder,
  closeFinder,
  createRecorder,
} = require("./capture-lib");

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const FPS = 60;
const CAPTURE_DPR = 2;
const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// The analyst whose archive and queue the promo films, with their consent.
const USERNAME = "MPGeoint";
const EMAIL = process.env.VIDIT_DEMO_EMAIL || "mpgeoint@gmail.com";
const PASSWORD = process.env.VIDIT_DEMO_PASSWORD;

// The trimmed copy of that analyst's own export. Its basename and byte size
// are what the mock open dialog shows, so the row on camera describes the file
// that is actually imported.
const ARCHIVE = path.join(__dirname, "out", "x-archive-trimmed.zip");

// How long the privacy line holds. It is the objection every analyst raises
// when asked for their X archive, so it is the one frame the storyboard pins
// to a duration rather than to a gesture.
const PRIVACY_HOLD_MS = 5200;

// The closing camera. The take eases to the point it just published so the
// closing frame carries that work rather than an arbitrary view.
const CLOSING_ZOOM = 5.4;

const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
});

const api = (auth, method, pathname, body) => apiCall(API, auth, method, pathname, body);

// ─── the draft the review beat opens ─────────────────────────────────────

function proofHasImage(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "image") return true;
  return (node.content || []).some(proofHasImage);
}

// Everything `missingEventFields` asks for except the two tags, which the
// take fills on camera. A draft short of any of it cannot be submitted, and
// the submit button would refuse to arm mid-beat.
function clearsSubmitFloor(draft) {
  return (
    !!draft.title?.trim() &&
    !!draft.event_coords &&
    !!draft.source_url?.trim() &&
    !!draft.source_posted_at &&
    proofHasImage(draft.proof) &&
    (draft.media || []).some((m) => m.role === "source")
  );
}

// What the take types into the conflict picker, from the draft's own
// coordinates. Deliberately a short list of boxes rather than a guess for
// every point on earth: the conflict is a claim about someone else's work, so
// a draft whose coordinates fall outside these boxes is not filmed at all
// (see `pickReviewTarget`) rather than tagged with the nearest plausible war.
// The suggestion the take clicks is whatever the product returns for the
// search, and the capture source stays `Unknown`, which asserts nothing.
// The name is typed in full and the pill clicked is the one carrying it, so
// the pick cannot drift onto whichever narrower conflict the typeahead happens
// to rank first for a loose query.
function conflictQueryFor(coords) {
  const { lat, lng } = coords;
  // Ukraine and the Russian border oblasts the archive documents. The north
  // edge stops short of Moscow on purpose: a point deep inside Russia is not
  // war coverage by its coordinates alone.
  if (lat > 44 && lat < 53 && lng > 22 && lng < 41) return "Russo-Ukrainian war";
  if (lat > 29 && lat < 34 && lng > 33 && lng < 36) return "Gaza War";
  if (lat > 31 && lat < 38 && lng > 35 && lng < 43) return "Syrian civil war";
  return null;
}

// The review beat opens a draft off the queue's Ready filter, so the click
// lands on the page the filter beat just produced. Three further conditions:
// the draft has to clear the submit floor, it has to sit inside the batch the
// review pass walks (that batch is what gives the form its "Draft n of m"
// position and its next draft), and its coordinates have to fall inside a
// conflict box the take can name.
async function pickReviewTarget(auth) {
  const walk = await api(auth, "GET", "/events/detections?page=1&per_page=100&readiness=all");
  const walkIds = new Map(walk.items.map((it, i) => [it.id, i]));
  const ready = await api(auth, "GET", "/events/detections?page=1&per_page=10&readiness=ready");
  for (const row of ready.items) {
    const position = walkIds.get(row.id);
    if (position === undefined || position >= walk.items.length - 1) continue;
    if (!clearsSubmitFloor(row)) continue;
    const query = conflictQueryFor(row.event_coords);
    if (!query) continue;
    console.log(
      `  review target: ${row.title} (${row.id})  ·  Draft ${position + 1} of ${walk.total}` +
        `  ·  conflict search "${query}"`
    );
    return { row, next: walk.items[position + 1], query };
  }
  throw new Error(
    "no draft on the Ready filter's first page clears the submit floor inside a " +
      "named conflict box; review the queue by hand"
  );
}

// ─── the take ────────────────────────────────────────────────────────────

async function clipImportReview(auth) {
  const zipBytes = fs.statSync(ARCHIVE).size;
  const zipName = path.basename(ARCHIVE);

  await recordClip("import-review", { cookies: auth.cookies }, async (page, rec) => {
    const openImportPanel = async () => {
      await page.goto(`${BASE}/submit?import=1`, { waitUntil: "domcontentloaded" });
      await page
        .getByText("Choose your X archive", { exact: false })
        .first()
        .waitFor({ timeout: 25000 });
      await wait(1200);
    };

    // ── setup pass (silent) ──────────────────────────────────────────────
    // Warm every route the take navigates to. The dev server compiles a route
    // on first visit, and a compile stall inside a recorded beat reads as the
    // product being slow.
    console.log("→ setup pass: warm the routes");
    await openImportPanel();
    await page.goto(`${BASE}/profile/${USERNAME}/detections`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Detections" }).waitFor({ timeout: 25000 });
    const warm = await api(auth, "GET", "/events/detections?page=1&per_page=1&readiness=ready");
    if (warm.items.length) {
      await page.goto(`${BASE}/events/${warm.items[0].id}/edit?queue=1`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
    }
    await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
    await wait(2000);

    // ── recorded pass ────────────────────────────────────────────────────
    console.log("→ recorded pass");
    await openImportPanel();
    // The mouse is deliberately not moved before the first click beat: the
    // DOM cursor overlay only paints after a mousemove, so the opening frames
    // carry no cursor at all.
    rec.start();

    // 1. The import panel: the export guide, then the picker opening.
    console.log("→ the import panel");
    rec.mark("panel");
    await wait(3000);

    const chooseBtn = page.getByText("Choose your X archive", { exact: false }).first();
    await slowScrollToLocator(page, chooseBtn, 1400);
    await wait(700);

    console.log("→ open the mock Finder dialog");
    page.on("filechooser", () => {}); // headless: swallow the real chooser
    rec.mark("finderOpen");
    await glideAndClick(page, chooseBtn, { steps: 48, settle: 400 });
    await injectFinder(page, zipName, zipBytes);
    await wait(1100);

    console.log("→ pick the archive");
    const rowBox = await page.locator("#__finder_zip_row__").boundingBox();
    const rowX = rowBox.x + rowBox.width * 0.3;
    const rowY = rowBox.y + rowBox.height / 2;
    await page.mouse.move(rowX, rowY, { steps: 45 });
    await wait(450);
    await page.mouse.click(rowX, rowY); // select, the row highlights
    await wait(700);
    rec.mark("finderPick");
    await page.mouse.dblclick(rowX, rowY);
    await closeFinder(page);
    await wait(300);

    const zipInput = page.locator('input[type="file"][accept*="zip"]').first();
    await zipInput.setInputFiles({
      name: zipName,
      mimeType: "application/zip",
      buffer: fs.readFileSync(ARCHIVE),
    });
    rec.mark("filePicked");
    await wait(1800); // the file card ("ready to import") breathes

    // 2. The progress steps. The privacy line carries `keepDetail`, so it
    //    stays on screen for the whole run; the hold is what the storyboard
    //    pins, not the step's own lifetime.
    console.log("→ import, then hold on the privacy line");
    const importBtn = page.getByRole("button", { name: /^import archive$/i }).first();
    await glideAndClick(page, importBtn);
    rec.mark("importClick");
    await wait(400);
    await slowScrollToLocator(
      page,
      page.getByText("Filtering out private data").first(),
      1000,
      240
    ).catch(() => {});
    await page
      .getByText("never leave your device", { exact: false })
      .first()
      .waitFor({ timeout: 60000 })
      .catch(() => console.warn("  (the privacy line never showed)"));
    rec.mark("privacyHold");
    await wait(PRIVACY_HOLD_MS);

    console.log("→ wait for Done");
    const reviewCta = page.getByRole("link", { name: /review your detections/i }).first();
    await reviewCta.waitFor({ timeout: 900000 });
    rec.mark("importDone");
    const summary = await page
      .locator("li", { hasText: "Done" })
      .first()
      .innerText()
      .catch(() => "");
    console.log(`  the Done step reads: ${summary.replace(/\s+/g, " ").trim()}`);
    await wait(2200); // the finished stepper and its summary read

    // 3. The queue: the rows the import produced sit on top, the badges say
    //    what each row still needs, and the filter counts the whole queue.
    console.log("→ the detections queue");
    const ctaBox = await reviewCta.boundingBox();
    if (!ctaBox || ctaBox.y < 0 || ctaBox.y + ctaBox.height > 700) {
      await smoothScrollIntoView(page, reviewCta, 900);
    }
    await glideAndClick(page, reviewCta, { steps: 48 });
    await page.waitForURL(/\/profile\/[^/]+\/detections/, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('a[href^="/events/"][href$="?queue=1"]', { timeout: 20000 });
    rec.mark("queueOpen");
    await wait(2600);

    console.log("→ the readiness filter");
    rec.mark("filterReady");
    await glideAndClick(
      page,
      page.locator('[aria-label="Filter the queue"]').getByRole("button", { name: "Ready" }),
      { steps: 40 }
    );
    await wait(2400); // the narrowed page and its counts read

    // 4. One draft, opened into the review pass.
    const { row: target, next, query } = await pickReviewTarget(auth);
    const card = page.locator(`a[href="/events/${target.id}/edit?queue=1"]`).first();
    await card.waitFor({ timeout: 15000 });
    await wait(900);
    console.log("→ open the draft");
    await smoothScrollIntoView(page, card, 1200);
    await wait(400);
    await glideClickStretchedCard(page, card, target.id);
    await page.waitForURL(new RegExp(`/events/${target.id}/edit`), {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
    await page.waitForSelector('input[aria-label="Search conflicts"]', { timeout: 20000 });
    await page
      .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
      .catch(() => {});
    rec.mark("draftOpen");
    await wait(2000); // the position, the title and the media

    console.log("→ scroll the draft: media, the point, the proof");
    rec.mark("draftScroll");
    await slowScrollToLocator(
      page,
      page.locator('input[aria-label="Search conflicts"]').first(),
      2600,
      420
    );
    await wait(1400);

    // 5. The human's part on camera: the conflict and the capture source.
    console.log("→ the conflict and the capture source");
    const conflictInput = page.locator('input[aria-label="Search conflicts"]').first();
    rec.mark("tagFill");
    await glideAndClick(page, conflictInput, { steps: 42, settle: 380 });
    await page.keyboard.type(query, { delay: 55 });
    await wait(700);
    // `conflictLabel` may append the years, so anchor on the start of the name
    // rather than on the whole label.
    const suggestion = page
      .getByRole("button", { name: new RegExp(`^${query}(\\s*\\(|$)`, "i") })
      .first();
    await suggestion.waitFor({ timeout: 10000 });
    await glideAndClick(page, suggestion, { steps: 30, settle: 350 });
    await wait(700);

    const captureChip = page.getByRole("button", { name: /^Unknown$/ }).first();
    await slowScrollToLocator(page, captureChip, 900, 340).catch(() => {});
    await wait(300);
    await glideAndClick(page, captureChip, { steps: 34, settle: 380 });
    await wait(800);

    console.log("→ Submit (arm, then confirm), the next draft opens itself");
    await slowScrollToY(
      page,
      await page.evaluate(() => document.documentElement.scrollHeight),
      2200
    );
    await wait(700);
    // Located by type rather than by name: the label walks Submit -> Confirm
    // submit -> Submitting… across the two clicks. The second click has to
    // land inside ARM_MS (3s), so the settle stays short.
    const submitBtn = page.locator('form button[type="submit"]').first();
    rec.mark("submitClick");
    await glideAndClick(page, submitBtn, { steps: 38, settle: 520 });
    await page
      .getByRole("button", { name: /confirm submit/i })
      .first()
      .waitFor({ timeout: 5000 });
    await wait(650); // the armed ring reads before the confirming click
    await glideAndClick(page, submitBtn, { steps: 10, settle: 260 });
    await page.waitForURL(new RegExp(`/events/${next.id}/edit`), { timeout: 40000 });
    await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
    rec.mark("nextDraft");
    await wait(2600);

    // 6. The map, eased onto the point the take just published.
    console.log("→ the map");
    rec.mark("mapNav");
    await glideAndClick(page, page.locator('aside a[href="/map"]').first(), { steps: 48 });
    await page.waitForURL(/\/map/, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
    await page.waitForFunction(() => !!window.__viditMap, { timeout: 30000 });
    await wait(3200); // tiles and the points fetch settle
    rec.mark("mapOpen");
    await wait(1200);
    rec.mark("mapEase");
    await easeCamera(page, {
      center: [target.event_coords.lng, target.event_coords.lat],
      zoom: CLOSING_ZOOM,
      durationMs: 2600,
    });
    await wait(1600);
  });
}

(async () => {
  if (!PASSWORD) {
    throw new Error("set VIDIT_DEMO_PASSWORD to the demo account's local password");
  }
  if (!fs.existsSync(ARCHIVE)) {
    throw new Error(
      `no trimmed archive at ${ARCHIVE} — run prep-review-take.py first (see video/README.md)`
    );
  }
  const auth = await mintCookies(API, EMAIL, PASSWORD);
  const me = await api(auth, "GET", "/auth/me");
  if (me.username !== USERNAME) {
    throw new Error(`signed in as ${me.username}, expected ${USERNAME}`);
  }
  const queue = await api(auth, "GET", "/events/detections?page=1&per_page=1&readiness=all");
  console.log(
    `queue before the import: ${queue.total} drafts ` +
      `(${queue.ready_total} ready, ${queue.incomplete_total} incomplete)`
  );
  await clipImportReview(auth);
  console.log("\n✓ import and review take recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
