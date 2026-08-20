// v0.5 promo B ("import and review"): ONE continuous signed-in take of the
// archive import and the review pass, recorded against a running instance.
//
//   import-review.mp4  the bulk-import panel -> the archive picker -> the
//                      progress steps -> the detections queue with its
//                      readiness filter -> one draft opened in the review pass
//                      -> submit -> the next draft opening on its own.
//
// The clip lands in public/clips/ next to the other takes, with its marks in
// meta.json; `gen-clips-manifest.js` compiles those into src/clips-manifest.ts
// and `src/PromoV05B.tsx` plays the take as ONE continuous window, hanging its
// captions off the marks.
//
// Nothing here is cut in the comp, so this file is the edit: every wait below
// is screen time at real speed, and its total is the promo's recorded length.
// The one exception is the import wait itself, from `privacyHold` to
// `importDone`, which is the worker's own time; the comp speeds through the
// middle of it rather than cutting it, so the stepper ticks past under the
// caption and the picture never jumps.
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
const { spawn } = require("child_process");
const {
  wait,
  mintCookies,
  apiCall,
  glideAndClick,
  slowScrollToY,
  slowScrollToLocator,
  smoothScrollIntoView,
  glideClickStretchedCard,
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

// How long the privacy line holds at real speed. It is the objection every
// analyst raises when asked for their X archive, so it is the one frame the
// storyboard pins to a duration rather than to a gesture. It no longer has to
// carry the whole read on its own: the comp keeps this beat at 1x and then
// speeds through the import wait behind the same caption, so the line is on
// screen far longer than it is held here.
const PRIVACY_HOLD_MS = 2400;

// The floor a draft's source media has to clear to be filmed, as a mean luma
// out of 255. A night clip is a black rectangle at promo size, which makes the
// review beat look like a broken player rather than like footage.
const MEDIA_LUMA_FLOOR = 45;

// How many rows the queue's page renders. Mirrors `DETECTIONS_PER_PAGE` in
// frontend/src/lib/events.ts: the take clicks a card, so it has to know which
// page that card is on.
const QUEUE_PAGE_SIZE = 10;

// How deep into the ready list the take is willing to walk for a filmable
// draft, in pages. The queue reads newest first, so the head of it is whatever
// the last import produced, and on an instance that has been imported into
// repeatedly that head is mostly near-duplicate rows of one long thread. Each
// page past the first costs one click on camera, which is why this is small:
// the beat is a review pass, not a tour of the pager.
const QUEUE_PAGES_SCANNED = 4;

const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
});

const api = (auth, method, pathname, body) => apiCall(API, auth, method, pathname, body);

// ─── the draft the review beat opens ─────────────────────────────────────

function proofImageCount(node) {
  if (!node || typeof node !== "object") return 0;
  const here = node.type === "image" ? 1 : 0;
  return here + (node.content || []).reduce((sum, c) => sum + proofImageCount(c), 0);
}

// The server's cap on the proof body, mirroring `max_proof_images_per_event`
// in backend/app/config.py. A draft over it is refused at publish, which on
// camera is a red banner and a submit that never advances: the archive's
// long threads carry proofs of a dozen images and more, so the queue really
// does hold rows the review pass cannot finish.
const MAX_PROOF_IMAGES = 10;

// Everything `missingEventFields` asks for except the two tags, which the take
// fills on camera, plus the one limit the server enforces at publish rather
// than the form at arm time. A draft short of any of it cannot be submitted:
// short of a field the button refuses to arm mid-beat, over the proof cap it
// arms, refuses on the second click and leaves a red banner on camera.
function clearsSubmitFloor(draft) {
  const images = proofImageCount(draft.proof);
  return (
    !!draft.title?.trim() &&
    !!draft.event_coords &&
    !!draft.source_url?.trim() &&
    !!draft.source_posted_at &&
    images > 0 &&
    images <= MAX_PROOF_IMAGES &&
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

// Whether a draft's source media will READ on camera, as a mean luma out of
// 255, or null when it cannot be read at all. Two failures look identical to a
// viewer and this catches both: media the instance cannot serve (a row
// restored from the production backup can still point at the CDN, which
// answers 403, and the player on camera stays empty) and media that arrives
// but is too dark to see. ffmpeg decodes a few frames spread over the head of
// the clip, scales them to a thumbnail and averages the grey.
function sourceLuma(url) {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-v", "error",
      "-i", url,
      "-vf", "fps=2,scale=48:27,format=gray",
      "-frames:v", "6",
      "-f", "rawvideo",
      "-",
    ]);
    const chunks = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.on("error", () => resolve(null));
    ff.on("close", () => {
      const bytes = Buffer.concat(chunks);
      if (!bytes.length) return resolve(null);
      let sum = 0;
      for (const v of bytes) sum += v;
      resolve(sum / bytes.length);
    });
  });
}

// The review beat opens a draft off the queue's Ready filter, so the click
// lands on the page the filter beat just produced. Four further conditions:
// the draft has to clear the submit floor, it has to sit inside the batch the
// review pass walks with something carrying footage after it (that batch is
// what gives the form its "Detection n of m" position, and the submit beat
// films it handing over the next draft, which the film ends on), its
// coordinates have to fall inside a conflict box the take can name, and its
// source media has to read on camera.
//
// The brightest qualifying draft wins rather than the first one. The conflict
// rule is untouched by that ordering: a draft outside the boxes is still not
// filmed at all, whatever its media looks like.
//
// Called in the SETUP pass, before a frame is recorded, because the probe
// spawns an ffmpeg per candidate and none of that waiting belongs inside a
// continuous take. That is safe against the import that follows: an idempotent
// re-import creates no rows, and the queue is ordered by `created_at`, so
// neither the batch order nor the chosen draft's position moves under it.
async function pickReviewTarget(auth) {
  const walk = await api(auth, "GET", "/events/detections?page=1&per_page=100&readiness=all");
  const walkIds = new Map(walk.items.map((it, i) => [it.id, i]));
  const ready = await api(
    auth,
    "GET",
    `/events/detections?page=1&per_page=${QUEUE_PAGE_SIZE * QUEUE_PAGES_SCANNED}&readiness=ready`
  );

  const candidates = [];
  for (const [readyIndex, row] of ready.items.entries()) {
    const position = walkIds.get(row.id);
    if (position === undefined || position >= walk.items.length - 1) continue;
    if (!clearsSubmitFloor(row)) continue;
    const query = conflictQueryFor(row.event_coords);
    if (!query) continue;
    const media = (row.media || []).find((m) => m.role === "source");
    if (!media?.storage_url) continue;
    // The draft the form hands over after the submit is the film's last
    // product frame, so it has to carry footage of its own: a media-less row
    // closes the film on an empty "Add media" box under a caption about the
    // next detection opening. Best effort by nature, since the queue can move
    // between this pick and the submit, but it is what makes the ordinary case
    // land on a filled form.
    const following = walk.items[position + 1];
    if (!(following.media || []).some((m) => m.role === "source" && m.storage_url)) continue;
    candidates.push({
      row,
      query,
      position,
      media,
      // Which page of the queue the cursor has to be on to see this card.
      queuePage: Math.floor(readyIndex / QUEUE_PAGE_SIZE) + 1,
    });
  }
  if (!candidates.length) {
    throw new Error(
      "no draft on the Ready filter's first page clears the submit floor inside a " +
        "named conflict box; review the queue by hand"
    );
  }
  // `card.waitFor` in the take is what enforces this in practice: a draft the
  // first page does not render is a draft the cursor cannot click.

  // Probed in queue order and stopped at the first draft that clears the
  // floor, so the take films the nearest filmable row rather than the
  // brightest one three pages in. Brightness is a threshold here, not a score:
  // past the floor the footage reads, and a page click costs more screen time
  // than a brighter clip buys.
  console.log(`→ probing the source media of ${candidates.length} candidates, in queue order`);
  let best = null;
  for (const c of candidates) {
    c.luma = await sourceLuma(c.media.storage_url);
    console.log(
      `  ${c.luma === null ? "unreadable" : `luma ${c.luma.toFixed(0).padStart(3)}`}` +
        `  page ${c.queuePage}  ${c.row.title}`
    );
    if (c.luma !== null && c.luma >= MEDIA_LUMA_FLOOR) {
      best = c;
      break;
    }
  }
  if (!best) {
    const readable = candidates.filter((c) => c.luma !== null);
    if (!readable.length) {
      throw new Error(
        `no draft in the first ${QUEUE_PAGES_SCANNED} pages of the Ready filter has source ` +
          "media this instance can serve. The rows carry CDN links the local " +
          "backend does not hold, so the review beat would film an empty player."
      );
    }
    readable.sort((a, b) => b.luma - a.luma);
    best = readable[0];
    console.warn(
      `  (nothing clears the ${MEDIA_LUMA_FLOOR} floor; filming the brightest at ` +
        `${best.luma.toFixed(0)}, the footage will be dark on camera)`
    );
  }
  console.log(
    `  review target: ${best.row.title} (${best.row.id})` +
      `  ·  Detection ${best.position + 1} of ${walk.total}` +
      `  ·  queue page ${best.queuePage}` +
      `  ·  conflict search "${best.query}"`
  );
  return best;
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
    // product being slow. The draft the review beat opens is chosen here too,
    // media probe included, so the recorded pass spends no time deciding.
    console.log("→ setup pass: pick the draft, warm the routes");
    const { row: target, query, queuePage } = await pickReviewTarget(auth);
    await openImportPanel();
    await page.goto(`${BASE}/profile/${USERNAME}/detections`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Detections" }).waitFor({ timeout: 25000 });
    await page.goto(`${BASE}/events/${target.id}/edit?queue=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
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

    // The take is played back as ONE continuous window, so every wait below is
    // screen time and every beat has to earn its own. The only stretch the comp
    // compresses is the import wait itself (`privacyHold` to `importDone`),
    // which is the worker's real time and cannot be shortened here.
    //
    // The opening is the tightest part of the film: staging a file is the least
    // interesting thing the product does, and its caption is up from the first
    // frame, so the guide, the dialog and the staged card each hold just long
    // enough to be read.
    //
    // The cursor is paced the same way throughout. Every glide names its own
    // `steps` and `settle` rather than taking the helper's defaults, because
    // the pointer crossing the screen is dead time in a film that has none to
    // spare: it has to arrive quickly enough not to be watched and slowly
    // enough to be followed. The holds that carry a caption are what the beats
    // are made of, so those stay generous.

    // 1. The import panel: the export guide, then the picker opening.
    console.log("→ the import panel");
    rec.mark("panel");
    await wait(900);

    const chooseBtn = page.getByText("Choose your X archive", { exact: false }).first();
    await slowScrollToLocator(page, chooseBtn, 700);
    await wait(150);

    console.log("→ open the mock Finder dialog");
    page.on("filechooser", () => {}); // headless: swallow the real chooser
    rec.mark("finderOpen");
    await glideAndClick(page, chooseBtn, { steps: 26, settle: 170 });
    await injectFinder(page, zipName, zipBytes);
    await wait(550);

    console.log("→ pick the archive");
    const rowBox = await page.locator("#__finder_zip_row__").boundingBox();
    const rowX = rowBox.x + rowBox.width * 0.3;
    const rowY = rowBox.y + rowBox.height / 2;
    await page.mouse.move(rowX, rowY, { steps: 24 });
    await wait(170);
    await page.mouse.click(rowX, rowY); // select, the row highlights
    await wait(250);
    rec.mark("finderPick");
    await page.mouse.dblclick(rowX, rowY);
    await closeFinder(page);
    await wait(150);

    const zipInput = page.locator('input[type="file"][accept*="zip"]').first();
    // By path, not by buffer: Playwright caps an in-memory payload at 50 MB
    // and a real export is far past that. The name and size on camera come
    // from the file itself.
    await zipInput.setInputFiles(ARCHIVE);
    rec.mark("filePicked");
    await wait(650); // the file card ("ready to import") breathes

    // 2. The progress steps. The privacy line carries `keepDetail`, so it
    //    stays on screen for the whole run; the hold is what the storyboard
    //    pins, not the step's own lifetime.
    console.log("→ import, then hold on the privacy line");
    const importBtn = page.getByRole("button", { name: /^import archive$/i }).first();
    await glideAndClick(page, importBtn, { steps: 28, settle: 250 });
    rec.mark("importClick");
    await wait(400);
    await slowScrollToLocator(
      page,
      page.getByText("Filtering out private data").first(),
      1000,
      240
    ).catch(() => {});
    // The step's own detail line, in full: the export guide above the form
    // carries a second sentence ending in "never leave your device", so a
    // looser query resolves against that one and the mark lands before the
    // stepper is up.
    await page
      .getByText("DMs, messages and account data never leave your device.")
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
    await wait(2400); // the finished stepper and its outcome line read

    // 3. The queue: the rows the import produced sit on top, the badges say
    //    what each row still needs, and the filter counts the whole queue.
    console.log("→ the detections queue");
    const ctaBox = await reviewCta.boundingBox();
    if (!ctaBox || ctaBox.y < 0 || ctaBox.y + ctaBox.height > 700) {
      await smoothScrollIntoView(page, reviewCta, 700);
    }
    await glideAndClick(page, reviewCta, { steps: 30, settle: 280 });
    await page.waitForURL(/\/profile\/[^/]+\/detections/, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    // The instant the route changed, so the comp's faked address bar swaps
    // with the picture rather than a page load later.
    rec.mark("queueUrl");
    await page.waitForSelector('a[href^="/events/"][href$="?queue=1"]', { timeout: 20000 });
    rec.mark("queueOpen");
    await wait(2500);

    console.log("→ the readiness filter");
    rec.mark("filterReady");
    await glideAndClick(
      page,
      page.locator('[aria-label="Filter the queue"]').getByRole("button", { name: "Ready" }),
      { steps: 26, settle: 280 }
    );
    await wait(2300); // the narrowed page and its counts read

    // 4. One draft, opened into the review pass. The draft was chosen in the
    //    setup pass, so this beat is the paging and the click. Paging is
    //    ordinary use of the queue rather than a detour: the pager says how
    //    deep the queue runs, which is the same claim the counts make.
    //
    //    It pages until the card is ON SCREEN rather than to a page number
    //    worked out in advance. The queue reads newest first and the import
    //    that runs between the pick and this beat can put rows above the one
    //    the take is after, which moves it down by a page without changing
    //    anything a viewer could see. `queuePage` is what the pick expected;
    //    the loop is what the queue actually shows.
    const card = page.locator(`a[href="/events/${target.id}/edit?queue=1"]`).first();
    const nextPage = page.getByRole("button", { name: "Next" }).first();
    console.log(`→ paging to the card (expected on page ${queuePage})`);
    let onScreen = await card.isVisible().catch(() => false);
    for (let p = 1; !onScreen && p < QUEUE_PAGES_SCANNED; p++) {
      // The pager sits under ten rows, which puts it below the fold at this
      // viewport. `glideAndClick` drives the real mouse at page coordinates and
      // does not scroll the way a locator click would, so without this the
      // pointer clicks empty space off screen and the queue never moves.
      await smoothScrollIntoView(page, nextPage, 600);
      await glideAndClick(page, nextPage, { steps: 22, settle: 180 });
      await wait(650);
      onScreen = await card.isVisible().catch(() => false);
      console.log(`  · page ${p + 1}${onScreen ? " (the card is here)" : ""}`);
    }
    await card.waitFor({ timeout: 10000 });
    await wait(200);
    console.log("→ open the draft");
    await smoothScrollIntoView(page, card, 600);
    await wait(150);
    await glideClickStretchedCard(page, card, target.id, { steps: 48, settle: 430 });
    await page.waitForURL(new RegExp(`/events/${target.id}/edit`), {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    rec.mark("draftUrl");
    await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
    await page.waitForSelector('input[aria-label="Search conflicts"]', { timeout: 20000 });
    await page
      .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
      .catch(() => {});
    rec.mark("draftOpen");
    await wait(2200); // the position, the title and the media

    console.log("→ scroll the draft: media, the point, the proof");
    rec.mark("draftScroll");
    await slowScrollToLocator(
      page,
      page.locator('input[aria-label="Search conflicts"]').first(),
      1800,
      420
    );
    await wait(900);

    // 5. The human's part on camera: the conflict and the capture source.
    console.log("→ the conflict and the capture source");
    const conflictInput = page.locator('input[aria-label="Search conflicts"]').first();
    rec.mark("tagFill");
    await glideAndClick(page, conflictInput, { steps: 28, settle: 260 });
    await page.keyboard.type(query, { delay: 35 });
    await wait(400);
    // `conflictLabel` may append the years, so anchor on the start of the name
    // rather than on the whole label.
    const suggestion = page
      .getByRole("button", { name: new RegExp(`^${query}(\\s*\\(|$)`, "i") })
      .first();
    await suggestion.waitFor({ timeout: 10000 });
    await glideAndClick(page, suggestion, { steps: 20, settle: 240 });
    await wait(450);

    const captureChip = page.getByRole("button", { name: /^Unknown$/ }).first();
    await slowScrollToLocator(page, captureChip, 700, 340).catch(() => {});
    await wait(200);
    await glideAndClick(page, captureChip, { steps: 22, settle: 260 });
    await wait(500);

    console.log("→ Submit (arm, then confirm), the next draft opens itself");
    await slowScrollToY(
      page,
      await page.evaluate(() => document.documentElement.scrollHeight),
      1200
    );
    await wait(300);
    // Located by type rather than by name: the label walks Submit -> Confirm
    // submit -> Submitting… across the two clicks. The second click has to
    // land inside ARM_MS (3s), so the settle stays short.
    const submitBtn = page.locator('form button[type="submit"]').first();
    rec.mark("submitClick");
    await glideAndClick(page, submitBtn, { steps: 26, settle: 420 });
    await page
      .getByRole("button", { name: /confirm submit/i })
      .first()
      .waitFor({ timeout: 5000 });
    await wait(500); // the armed ring reads before the confirming click
    await glideAndClick(page, submitBtn, { steps: 8, settle: 220 });
    // Whatever draft the form hands over, not one named in advance. Which row
    // comes next is the queue's business at that instant, and the queue moves:
    // the import between the pick and this click can update rows, and the
    // submit itself takes one out. Waiting on a precomputed id makes the take
    // fail on a detail no viewer can see.
    const advanced = await page
      .waitForURL(
        (url) =>
          /\/events\/[0-9a-f-]{36}\/edit/.test(url.pathname) &&
          !url.pathname.includes(target.id),
        { timeout: 40000 }
      )
      .then(() => true)
      .catch(() => false);
    if (!advanced) {
      // A submit that does not advance is the one failure this take cannot
      // recover from, and the reason is always on screen. Say what it says
      // rather than making the next run guess from a timeout.
      // `FORM_ERROR_BANNER` in the frontend's form styles: what a refused
      // write says on this form.
      const banner = await page
        .locator("div.text-red-300, div.text-red-200, [role='alert']")
        .first()
        .innerText()
        .catch(() => "");
      const shot = path.join(__dirname, "out", "submit-failure.png");
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      throw new Error(
        `the submit never handed over the next draft (still at ${page.url()}). ` +
          `On screen: ${banner.replace(/\s+/g, " ").trim() || "(no banner)"}. ` +
          `Frame saved to ${shot}`
      );
    }
    await page.getByRole("heading", { name: "Submit detection" }).waitFor({ timeout: 30000 });
    // Let the next draft's own footage arrive before the beat starts, the same
    // wait the review beat opens with. This is the last product frame in the
    // film, and media popping into an empty box halfway through the closing
    // hold reads as the page still loading rather than as the pass continuing.
    // A poster frame is not an image, so waiting on `document.images` alone
    // closes the film on a black player whenever the row carries video: the
    // element is there, decoded to nothing. `readyState >= 2` is the frame.
    const tNext = Date.now();
    await page
      .waitForFunction(
        () => {
          const v = document.querySelector("video");
          return [...document.images].every((i) => i.complete) && (!v || v.readyState >= 2);
        },
        { timeout: 15000 }
      )
      .catch(() => {});
    console.log(`  · the next draft settled after ${Date.now() - tNext}ms`);
    // The last thing the take films: the queue handing over the next draft on
    // its own. The film ends here, on the pass continuing rather than on a
    // closing flourish, and the bot beat follows in the comp.
    rec.mark("nextDraft");
    await wait(2400);
  });
}

(async () => {
  if (!PASSWORD) {
    throw new Error("set VIDIT_DEMO_PASSWORD to the demo account's local password");
  }
  if (!fs.existsSync(ARCHIVE)) {
    throw new Error(
      `no trimmed archive at ${ARCHIVE}. Run prep-review-take.py first (see video/README.md)`
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
