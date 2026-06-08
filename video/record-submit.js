// Real-recording capture of the submit/import flow.
//
// Why not Playwright recordVideo: it emits VP8 at ~650 kbps, hard 25
// fps cap, IGNORES deviceScaleFactor → blurry on retina.
//
// Why not CDP Page.startScreencast: only emits frames when the renderer
// paints — idle waits (waiting for network, waiting for animations to
// "settle") produce no frames, so a 14s script becomes a 3s clip with
// awful pacing. A tight polling loop on page.screenshot() respects DPR
// and gives us deterministic, smooth output at the cost of some CPU.
//
// Why not ffmpeg avfoundation: it needs macOS Screen Recording
// permission on the parent process; CLI tools are silently denied.

const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const FRAMES_DIR = "./out/rec-frames";
// 60 fps capture. The 30 fps it ran at before is half what the comp
// (`Root.tsx`) renders at, so every captured frame played for 2 comp
// frames and motion was visibly stepped. At the existing 2560×1440
// JPEG q=95 frame cost (~10-12 ms with disk write ~1-2 ms) the
// grabber fits in the 16.6 ms per-frame budget with margin; pushing
// to 4K or q≥98 would not. Must stay paired with the ffmpeg encode's
// `-framerate 60` below.
const FPS = 60;
const TWEET_URL = "https://x.com/geo27752/status/2060086984513626223";
// For the live "Post a bounty" beat in the recording:
//   - The form's Source URL field gets a Telegram link — the realistic
//     case where an analyst sees footage on a Telegram channel they
//     can't geolocate and posts it for the community.
//   - The uploaded media is a video clip (the actual unplaced
//     footage), downloaded ahead of time from the analyst's tweet.
const BOUNTY_TWEET_URL = "https://x.com/geo27752/status/2053493295465078958";
const BOUNTY_SOURCE_URL = "https://t.me/intel_slava_z/14528";

// Cache path is computed PER FETCHED URL — `prepareBountyUpload` may
// fall back from `BOUNTY_TWEET_URL` to a sibling tweet if the primary's
// video proxy 502s, and we want the cache name to reflect whichever
// URL actually produced the bytes. Using a single global path keyed off
// `BOUNTY_TWEET_URL` would let one run's fallback contaminate every
// later run.
const bountyUploadCachePath = (url) =>
  path.join(
    os.tmpdir(),
    `vidit-bounty-upload-${crypto
      .createHash("sha1")
      .update(url)
      .digest("hex")
      .slice(0, 10)}.mp4`
  );

fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

async function mintCookies() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "analyst@vidit.app", password: "analyst" }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const out = [];
  let csrf = null;
  for (const c of res.headers.getSetCookie()) {
    const m = c.match(/^(vidit_session|vidit_csrf)=([^;]+)/);
    if (m) {
      out.push({ name: m[1], value: m[2], domain: "localhost", path: "/" });
      if (m[1] === "vidit_csrf") csrf = m[2];
    }
  }
  return {
    cookies: out,
    csrf,
    cookieHeader: out.map((c) => `${c.name}=${c.value}`).join("; "),
  };
}

// Human-paced sleep — readable on video.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Glide the mouse to a locator's centre with visible motion, then
// click. `steps` controls how many intermediate mousemove events fire
// during the glide — more = smoother and slower; the defaults below
// are tuned to feel human-paced (~0.5–0.8 s of visible travel for a
// medium glide). Returns the (x,y) we landed on so callers can chain
// another move from the same point.
async function glideAndClick(page, locator, { steps = 55, settle = 450 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  await wait(settle);
  await page.mouse.click(x, y);
  return { x, y };
}

// Glide-only (no click), useful for "approach" beats.
async function glideTo(page, x, y, { steps = 30 } = {}) {
  await page.mouse.move(x, y, { steps });
}

// Human-paced programmatic scroll. The browser's `scrollIntoView({
// behavior: "smooth" })` runs at a fixed (fast) cadence with no
// duration control; a custom ease-in-out over ~1.5–2.5s reads like
// someone gently scrolling the trackpad.
//
// CRITICAL: kick off the rAF loop inside the page and return
// IMMEDIATELY — do NOT return a Promise that resolves at end of scroll.
// page.evaluate(asyncFn) blocks the CDP session for the lifetime of the
// awaited Promise; page.screenshot shares that session, so a 2 s
// scroll-await drops the grabber from 30 fps to ~4 fps. The sleep
// happens in Node instead, with the scroll running fire-and-forget in
// the page.
async function slowScrollToY(page, targetY, durationMs = 1800) {
  await page.evaluate(
    ({ targetY, durationMs }) => {
      const startY = window.scrollY;
      const distance = targetY - startY;
      const start = performance.now();
      function step(now) {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        const eased =
          t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + distance * eased);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },
    { targetY, durationMs }
  );
  // Wait the scroll duration externally so the grabber keeps polling.
  await wait(durationMs + 50);
}

async function slowScrollToSelector(page, selector, durationMs = 1800) {
  const targetY = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return Math.max(0, window.scrollY + rect.top - window.innerHeight / 2);
  }, selector);
  if (targetY !== null) await slowScrollToY(page, targetY, durationMs);
}

// Variant of `slowScrollToSelector` that lands the target near the top
// of the viewport (default 80px in) instead of centering it. Useful
// when the section's BODY (proof editor + inline media) is what we
// want visible, not just the heading.
async function slowScrollToTopOf(
  page,
  selector,
  durationMs = 1800,
  offsetFromTop = 80
) {
  const targetY = await page.evaluate(
    ({ sel, offset }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return Math.max(0, window.scrollY + rect.top - offset);
    },
    { sel: selector, offset: offsetFromTop }
  );
  if (targetY !== null) await slowScrollToY(page, targetY, durationMs);
}

// Find the screen-space rect of a substring inside the ProseMirror
// proof editor. Returns `null` when the substring isn't currently in
// the rendered text (e.g., already deleted by a previous beat).
async function findProofTextRect(page, substring) {
  return page.evaluate((needle) => {
    const pm = document.querySelector(".ProseMirror");
    if (!pm) return null;
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf(needle);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    return null;
  }, substring);
}

// Mouse-drag to visibly select a substring in the proof editor, then
// press Delete. ProseMirror handles the keyboard event as a content
// removal, so the doc model + DOM stay in sync. No-op when the
// substring isn't found.
async function selectAndDeleteProofText(page, substring) {
  const rect = await findProofTextRect(page, substring);
  if (!rect) return false;
  const y = rect.y + rect.height / 2;
  const startX = rect.x + 0.5;
  const endX = rect.x + rect.width - 0.5;
  await page.mouse.move(startX, y, { steps: 20 });
  await wait(220);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 22 });
  await wait(280);
  await page.mouse.up();
  await wait(450);
  await page.keyboard.press("Delete");
  await wait(550);
  return true;
}

async function slowScrollToBottom(page, durationMs = 2200) {
  const targetY = await page.evaluate(
    () => document.documentElement.scrollHeight
  );
  await slowScrollToY(page, targetY, durationMs);
}

// Pre-fetch a VIDEO file from one of the analyst's tweets via the
// import-from-tweet media proxy, saved to `os.tmpdir()` so the
// recording's `setInputFiles` call is instant. Tries the dedicated
// bounty tweet first; falls back to a sibling tweet (`TWEET_URL`) if
// the primary's video proxy 502s — X CDN behaviour is unreliable.
//
// Returns the on-disk path the caller should upload, or null if no
// candidate produced a usable video. The cache filename embeds the
// hash of the URL the bytes actually came from, so a fallback fetch
// from `TWEET_URL` doesn't poison the cache slot of `BOUNTY_TWEET_URL`
// for the next run.
async function prepareBountyUpload(auth) {
  // Candidate tweets: the dedicated bounty tweet first, then the
  // Hezbollah/Iron Dome tweet from the geolocation submit flow (we
  // know that one's video proxy works).
  const candidates = [BOUNTY_TWEET_URL, TWEET_URL];
  for (const url of candidates) {
    const cachePath = bountyUploadCachePath(url);
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 10000) {
      console.log(`✓ reusing cached bounty video at ${cachePath} (from ${url})`);
      return cachePath;
    }
    try {
      const imp = await fetch(`${API}/geolocations/import-from-tweet`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: auth.cookieHeader,
          "X-CSRF-Token": auth.csrf,
        },
        body: JSON.stringify({ url }),
      }).then((r) => r.json());
      const video = (imp.media || []).find((m) => m.kind === "video");
      if (!video) continue;
      const proxyUrl =
        `${API}/geolocations/import-from-tweet/media?u=` +
        encodeURIComponent(video.remote_url);
      const res = await fetch(proxyUrl, {
        headers: { cookie: auth.cookieHeader },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10000) continue;
      fs.writeFileSync(cachePath, buf);
      console.log(
        `✓ cached bounty video at ${cachePath} (${(buf.length / 1024).toFixed(0)} KB) from ${url}`
      );
      return cachePath;
    } catch (e) {
      console.warn(`  prepareBountyUpload: ${url}: ${e.message}`);
    }
  }
  console.warn(
    "  no video could be downloaded; bounty form will have no media preview"
  );
  return null;
}

(async () => {
  const auth = await mintCookies();
  // `seed-bounties.js` already wiped tweet-coords duplicates under an
  // admin cookie before we got here, so the submit form starts clean
  // — no extra login needed in this script for that cleanup step.

  // Pre-fetch the bounty video so the upload during the recording is
  // instant. Returns the on-disk path to upload (per-URL cache), or
  // null if no candidate produced a usable video.
  const bountyUploadPath = await prepareBountyUpload(auth);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2, // 2 keeps frame size manageable; bump to 3 for sharper
  });
  await ctx.addCookies(auth.cookies);

  // Inject a DOM cursor overlay BEFORE any page script runs. The OS
  // cursor isn't captured by page.screenshot() (only the page bitmap
  // is); rendering our own SVG cursor inside the page DOM means it
  // shows up in every frame. Same init script also hides the
  // "Closed beta · v…" pill (`position: fixed` element that flickers
  // on scroll on some Chrome builds), once per page so the rule
  // survives navigations.
  await ctx.addInitScript(() => {
    const install = () => {
      // Hide the closed-beta pill site-wide via a stylesheet that gets
      // re-injected on every navigation.
      if (!document.getElementById("__demo_hide_beta__")) {
        const style = document.createElement("style");
        style.id = "__demo_hide_beta__";
        style.textContent =
          '[aria-label="Closed beta"] { display: none !important; }';
        document.head.appendChild(style);
      }
      if (document.getElementById("__demo_cursor__")) return;
      // Click pulse on the cursor itself — quick scale-down/back-up
      // beat on each mousedown, no continuous animation. Reads as the
      // analyst "tapping" without distracting visual chrome while the
      // cursor is just travelling. Implemented as a one-shot CSS
      // keyframe so the dip is visible even when Playwright's
      // synthetic mousedown → mouseup pair lands inside a single
      // frame (a JS-driven `style.transform =` toggle would race the
      // immediate reset and the dip would never appear on screen).
      const pulseStyle = document.createElement("style");
      pulseStyle.id = "__demo_cursor_pulse_kf__";
      pulseStyle.textContent =
        "@keyframes __demo_cursor_pulse__ {" +
        "  0%   { transform: scale(1); }" +
        "  25%  { transform: scale(0.85); }" +
        "  100% { transform: scale(1); }" +
        "}";
      document.head.appendChild(pulseStyle);

      const cursor = document.createElement("div");
      cursor.id = "__demo_cursor__";
      cursor.style.cssText = [
        "position: fixed",
        "left: 0",
        "top: 0",
        "width: 24px",
        "height: 24px",
        "pointer-events: none",
        "z-index: 2147483647",
        "will-change: transform",
        "transform: translate(-9999px, -9999px)",
      ].join(";");
      cursor.innerHTML =
        // The SVG sits inside its own wrapper so the click-pulse
        // (which mutates `transform: scale(...)`) doesn't fight the
        // mousemove handler that sets `transform: translate(...)` on
        // the outer `__demo_cursor__` element. ``transform-origin``
        // is the arrow's hotspot (top-left) so the scale doesn't
        // drift the visual click point off-pixel.
        '<div id="__demo_cursor_inner__" style="transform-origin:2px 2px;">' +
        '<svg width="24" height="24" viewBox="0 0 28 28" style="display:block;filter:drop-shadow(0 1.5px 2px rgba(0,0,0,0.55))">' +
        '<path d="M 2 2 L 2 22 L 7.5 17.5 L 11 25 L 14 23.5 L 10.5 16 L 18 16 Z" ' +
        'fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round" />' +
        "</svg>" +
        "</div>";

      document.documentElement.appendChild(cursor);
      const cursorInner = document.getElementById("__demo_cursor_inner__");

      document.addEventListener(
        "mousemove",
        (e) => {
          cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        },
        true
      );
      // Trigger the one-shot pulse on mousedown. Removing then
      // re-adding the animation property (with a reflow in between)
      // re-runs the keyframe even when the previous run hasn't
      // finished — every click gets its own dip beat.
      document.addEventListener(
        "mousedown",
        () => {
          cursorInner.style.animation = "none";
          // Force reflow so removing + re-adding `animation` actually
          // restarts the keyframe rather than being collapsed by the
          // browser as a no-op style update.
          void cursorInner.offsetWidth;
          cursorInner.style.animation =
            "__demo_cursor_pulse__ 320ms cubic-bezier(0.4,0,0.6,1)";
        },
        true
      );
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install);
    } else {
      install();
    }
  });

  const page = await ctx.newPage();

  // ─── Polling-loop frame grabber (deferred) ──────────────────────────────
  // page.screenshot() respects deviceScaleFactor so we get true 2560×1440
  // frames. The grabber is defined here but NOT started — callers fire
  // `startGrabber()` AFTER the setup phase (page nav, pre-record state
  // changes), otherwise the recording's first frames are the navigation
  // flash + setup clicks playing out on camera.
  let frameIdx = 0;
  let stopped = false;
  let grabber = Promise.resolve();
  const FRAME_INTERVAL_MS = 1000 / FPS;
  const startGrabber = () => {
    grabber = (async () => {
      while (!stopped) {
        const t = Date.now();
        try {
          const buf = await page.screenshot({
            type: "jpeg",
            quality: 95,
          });
          const filename = path.join(
            FRAMES_DIR,
            `f_${String(frameIdx++).padStart(5, "0")}.jpg`
          );
          fs.writeFileSync(filename, buf);
        } catch (e) {
          if (!stopped) console.warn("grab failed:", e.message);
          break;
        }
        const elapsed = Date.now() - t;
        const sleep = FRAME_INTERVAL_MS - elapsed;
        if (sleep > 0) await wait(sleep);
      }
    })();
  };

  // ─── The flow ───────────────────────────────────────────────────────────
  console.log("→ navigate to /map");
  // `networkidle` was timing out once the map started serving the
  // ~1000 demo geolocations — the points fetch + clustering keeps
  // network activity going past Playwright's 500 ms "idle" window.
  // `domcontentloaded` is good enough here; the subsequent
  // `waitForSelector` calls below handle the actual readiness signals.
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href="/map"]', { timeout: 10000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 10000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".maplibregl-canvas");
      return c && c.clientWidth > 0 && c.clientHeight > 0;
    },
    { timeout: 10000 }
  );
  await wait(2500); // WebGL tiles + cluster pins settle

  // Pre-recording: collapse the Filters panel SILENTLY so the very
  // first frame the grabber captures already shows a clean map. The
  // user explicitly didn't want to see the collapse action on camera.
  console.log("→ pre-record: collapse Filters panel (silently)");
  await page
    .getByRole("button")
    .filter({ hasText: /^Filters/ })
    .first()
    .click();
  await wait(800); // panel collapse animation finishes before recording


  // Seed the cursor mid-canvas (instant teleport — no glide events fire
  // with this form). It'll be its initial position when the grabber
  // starts capturing the very next frame.
  await page.mouse.move(700, 360);

  console.log("→ recording starts");
  startGrabber();
  const t0 = Date.now();
  // Opening beat on the map so the cold-open caption ("Every conflict
  // event. One map.") has time to land before the sidebar tour starts.
  await wait(3500);

  console.log("→ expand sidebar (so labels are visible during the tour)");
  const expandBtn = page.locator('button[aria-label="Expand sidebar"]').first();
  await glideAndClick(page, expandBtn, { steps: 45, settle: 400 });
  await wait(900); // expand animation + labels fade in

  console.log("→ sidebar tour (Bounties → Timeline)");
  for (const sel of [
    'a[href="/bounties"]',
    'a[href="/timeline"]',
  ]) {
    const box = await page.locator(sel).first().boundingBox();
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { steps: 45 }
      );
      await wait(650);
    }
  }

  console.log("→ click Submit (+) → /geolocations/new");
  const submitNav = page.locator('a[href="/geolocations/new"]').first();
  await glideAndClick(page, submitNav, { steps: 45, settle: 400 });
  await page.waitForSelector('input[type="url"]', { timeout: 10000 });
  await wait(700);

  console.log("→ collapse sidebar (back to icons after the tour)");
  const collapseBtn = page
    .locator('button[aria-label="Collapse sidebar"]')
    .first();
  await glideAndClick(page, collapseBtn, { steps: 50, settle: 400 });
  await wait(900); // collapse animation finishes

  console.log("→ glide → click URL input");
  const urlInput = page.locator('input[type="url"]').first();
  await glideAndClick(page, urlInput, { steps: 55, settle: 400 });
  await wait(450);

  console.log("→ paste URL (instant, no typing)");
  await urlInput.fill(TWEET_URL);
  await wait(900);

  console.log("→ glide → click Import");
  const importBtn = page.getByRole("button", { name: /^import$/i }).first();
  await glideAndClick(page, importBtn, { steps: 40, settle: 350 });
  // Backend round-trips X and parses the tweet; the real "Importing…"
  // state shows in the recording during this wait.
  await page.waitForFunction(
    () => {
      const el = document.getElementById("title");
      return el && el.value && el.value.length > 5;
    },
    { timeout: 30000 }
  );
  await wait(2500); // media thumbnails render
  await wait(900); // longer beat to read the prefilled form

  console.log("→ scroll to tags (slow, human-paced)");
  // Find the Tags header's id/selector dynamically — there's no stable
  // hook, so locate by heading text and synthesise an inline data-attr
  // we can target.
  await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("h2,h3"));
    const tags = headers.find((h) => /tags/i.test(h.textContent || ""));
    if (tags) tags.setAttribute("data-promo-anchor", "tags");
  });
  await slowScrollToSelector(page, '[data-promo-anchor="tags"]', 2200);
  await wait(600);

  console.log("→ glide → click curated tag chips");
  for (const name of ["Israel Gaza", "Drone"]) {
    const chip = page
      .getByRole("button", { name: new RegExp(`^${name}$`, "i") })
      .first();
    await glideAndClick(page, chip, { steps: 38, settle: 320 });
    await wait(400);
  }
  await wait(500);

  console.log("→ type free tag → click Add");
  // Type the free tag instead of clicking a suggestion chip — the chip
  // is only rendered when the tag already has ≥1 live geolocation
  // reference, which the duplicate-wipe step strips. Typing + Add
  // produces the same UX beat without coupling the recording to demo
  // data we no longer keep around.
  const freeTagInput = page.getByLabel(/new free tag name/i).first();
  await glideAndClick(page, freeTagInput, { steps: 38, settle: 320 });
  await freeTagInput.type("drone strike", { delay: 55 });
  await wait(400);
  const addBtn = page.getByRole("button", { name: /^\+ add$/i }).first();
  await glideAndClick(page, addBtn, { steps: 38, settle: 320 });
  await wait(700);

  console.log("→ scroll to Proof (top-of-viewport so the body + media show)");
  // Tag the Proof header dynamically (no stable hook in the form
  // markup), then scroll with the heading near the TOP of the viewport
  // instead of centred — that puts the editor body and any inline
  // proof image in view, which is the part the analyst is about to
  // edit. The default `slowScrollToSelector` centres the header and
  // leaves the body partly clipped.
  await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("h2,h3"));
    const proof = headers.find((h) => /^proof/i.test(h.textContent || ""));
    if (proof) proof.setAttribute("data-promo-anchor", "proof");
  });
  await slowScrollToTopOf(page, '[data-promo-anchor="proof"]', 1800, 90);
  await wait(700);

  console.log("→ strip noise from proof (4× drag-select + Delete)");
  // The auto-import seeds the proof with the OP tweet text +
  // `Source:` attribution paragraph. Four chunks are noise the
  // analyst would clean before publishing:
  //   1. `(img 4th attack)` — the OP's own parenthetical reference
  //      to the tweet's images, irrelevant once the images sit
  //      inline in the proof.
  //   2. `Geolocation: 33.2241725, 35.5489751` — duplicates the
  //      lat/lng fields filled in above.
  //   3. `https://t.co/dKCgli05Hl` — the OP's t.co shortener (no
  //      content value once the canonical URL is in the source
  //      field).
  //   4. `https://t.co/1us3ra5ZJO` — same, on the Source paragraph.
  // Each search string includes the surrounding `\n\n` separators
  // when present so the orphan line breaks vanish with the chunk;
  // without that the proof keeps visible blank lines after the
  // delete. Falls back to the bare string if the leading `\n\n`
  // form isn't found (e.g., after a previous delete collapsed the
  // separators).
  const proofCuts = [
    ["\n\n(img 4th attack)", "(img 4th attack)"],
    [
      "\n\nGeolocation: 33.2241725, 35.5489751",
      "Geolocation: 33.2241725, 35.5489751",
    ],
    [" https://t.co/dKCgli05Hl", "https://t.co/dKCgli05Hl"],
    [" https://t.co/1us3ra5ZJO", "https://t.co/1us3ra5ZJO"],
  ];
  for (const variants of proofCuts) {
    for (const needle of variants) {
      if (await selectAndDeleteProofText(page, needle)) break;
    }
  }
  // Belt-and-braces collapse: walk the proof's text nodes and squeeze
  // any double-newlines that survived the deletes (Tiptap sometimes
  // keeps the `\n` chars even when the surrounding text is gone). The
  // mutation goes through ProseMirror's contenteditable surface via
  // execCommand so the editor model picks up the change.
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (!pm) return;
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const before = node.textContent || "";
      const after = before
        .replace(/\n{2,}/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/^ /, "")
        .replace(/ $/, "");
      if (after !== before) node.textContent = after;
    }
  });
  await wait(900); // beat to read the cleaned proof

  console.log("→ scroll to submit (slow)");
  await slowScrollToBottom(page, 2400);
  await wait(700);

  console.log("→ glide → click Submit geolocation");
  const submitBtn = page
    .getByRole("button", { name: /^submit geolocation/i })
    .first();
  await glideAndClick(page, submitBtn, { steps: 55, settle: 450 });
  // The page redirects to /geolocations/{id} on success — capture the
  // transition so the cut is *the page itself navigating*, not an edit.
  await page.waitForURL(/\/geolocations\/[0-9a-f-]+(?:$|\?)/i, {
    timeout: 30000,
  });
  // Let the detail page render (map, fields, media thumbnails).
  await wait(3000);

  // Iteration shortcut — flip to `true` to truncate the recording
  // right after the geolocation submit (no bounty browse, no bounty
  // post). Useful when tuning the form-fill / proof-edit beats; the
  // full flow adds ~40s of capture + render time.
  const STOP_AFTER_SUBMIT = false;
  if (STOP_AFTER_SUBMIT) {
    console.log("→ stop grabber early (STOP_AFTER_SUBMIT=true)");
    stopped = true;
    const tEndEarly = Date.now();
    await grabber;
    await browser.close();
    const wallEarly = (tEndEarly - t0) / 1000;
    const fpsEarly = frameIdx / wallEarly;
    console.log(
      `\nCaptured ${frameIdx} frames in ${wallEarly.toFixed(1)}s` +
        ` (${fpsEarly.toFixed(2)} fps; target ${FPS})`
    );
    console.log("→ encode mp4");
    const outPathEarly = "./out/recording-submit.mp4";
    const ffEarly = spawn(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        fpsEarly.toFixed(3),
        "-i",
        `${FRAMES_DIR}/f_%05d.jpg`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "16",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        outPathEarly,
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
    await new Promise((resolve, reject) => {
      ffEarly.on("exit", (code) => {
        if (code === 0) {
          console.log(`\n✓ ${outPathEarly}`);
          resolve();
        } else {
          reject(new Error(`ffmpeg exit ${code}`));
        }
      });
      ffEarly.on("error", reject);
    });
    return;
  }

  console.log("→ glide → click Bounties (in sidebar)");
  const bountiesNav = page.locator('a[href="/bounties"]').first();
  await glideAndClick(page, bountiesNav, { steps: 50, settle: 400 });
  await page.waitForURL(/\/bounties(\?|$)/i, { timeout: 10000 });
  await page.waitForSelector('a[href^="/bounties/"]', { timeout: 10000 });
  await wait(1600); // scan the list

  console.log("→ click first bounty (view detail)");
  const firstBountyCard = page
    .locator('a[href^="/bounties/"]:not([href$="/new"])')
    .first();
  await glideAndClick(page, firstBountyCard, { steps: 50, settle: 400 });
  await page.waitForURL(/\/bounties\/[0-9a-f-]+(?:$|\?)/i, { timeout: 10000 });
  await wait(1800); // beat on detail to read it

  console.log("→ click 'I'm working on this' (signal participation)");
  // The button label flips to "Stop signaling" once clicked — capture
  // BOTH states by holding briefly after the click.
  const workingBtn = page
    .getByRole("button", { name: /^I'm working on this$/i })
    .first();
  // Slow scroll the action panel into view instead of the snappy
  // scrollIntoViewIfNeeded — matches the pace of the other scrolls.
  const workingY = await workingBtn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, window.scrollY + r.top - window.innerHeight / 2);
  });
  await slowScrollToY(page, workingY, 1500);
  await wait(400);
  await glideAndClick(page, workingBtn, { steps: 45, settle: 400 });
  await wait(1600); // hold so the new "Stop signaling" + worker count are visible

  console.log("→ click ← back arrow → /bounties");
  // Use the visible back arrow (PageShell's aria-label="Back") instead
  // of page.goBack(), so the cursor visibly travels to it and the
  // navigation reads as a deliberate user action.
  const backBtn = page.locator('button[aria-label="Back"]').first();
  await glideAndClick(page, backBtn, { steps: 45, settle: 400 });
  await page.waitForURL(/\/bounties(\?|$)/i, { timeout: 10000 });
  await wait(900);
  const postBtn = page
    .getByRole("link", { name: /^post bounty$/i })
    .first();
  await glideAndClick(page, postBtn, { steps: 45, settle: 400 });
  await page.waitForURL(/\/bounties\/new/i, { timeout: 10000 });
  await wait(900);

  console.log("→ fill bounty form (type title, paste source URL, attach media)");
  const titleInput = page.locator("#title").first();
  await glideAndClick(page, titleInput, { steps: 50, settle: 400 });
  // The title is an analyst's question, not a paste — type it
  // character-by-character so the viewer reads it forming.
  await titleInput.type(
    "Strike on tracked vehicle — anyone able to place this?",
    { delay: 55 }
  );
  await wait(900);

  // Source URL — the second deliberate paste in the promo (the first
  // was the tweet URL on the geolocation submit form). Slower glide,
  // longer dwell before AND after the paste, so the viewer sees the
  // cursor land on the field, then sees the full URL appear at once.
  const srcInput = page.locator("#source_url").first();
  await glideAndClick(page, srcInput, { steps: 50, settle: 500 });
  await wait(350); // cursor visibly on the field before the paste
  // Telegram link — the realistic shape of a "source I can't place"
  // that ends up posted as a bounty (footage from a Telegram channel
  // rather than a tweet the analyst already has context on).
  await srcInput.fill(BOUNTY_SOURCE_URL);
  await wait(1400); // URL stays on screen for the viewer to read it

  if (bountyUploadPath && fs.existsSync(bountyUploadPath)) {
    // Glide the cursor to the "Choose Files" button + fire a synthetic
    // mousedown for the click ripple, WITHOUT actually clicking the
    // native file input (that would open a real file-chooser dialog
    // Playwright can't dismiss headlessly). Then setInputFiles
    // attaches the cached video — the preview thumbnail appears
    // moments later, reading as "the user picked a file".
    const fileBtn = page.locator("#files").first();
    const fileBox = await fileBtn.boundingBox();
    if (fileBox) {
      const fx = fileBox.x + 80; // hit the "Choose Files" label, not the input itself
      const fy = fileBox.y + fileBox.height / 2;
      await page.mouse.move(fx, fy, { steps: 50 });
      await wait(400);
      // Synthetic mousedown → triggers the overlay's ripple animation
      // without dispatching the input's native click handler.
      await page.evaluate(
        ({ x, y }) => {
          document.dispatchEvent(
            new MouseEvent("mousedown", {
              clientX: x,
              clientY: y,
              bubbles: true,
            })
          );
        },
        { x: fx, y: fy }
      );
      await wait(450);
    }
    await fileBtn.setInputFiles(bountyUploadPath);
    await wait(1400); // preview thumbnail renders
  }

  console.log("→ glide → click Post the bounty");
  const submitBountyBtn = page
    .locator('button[type="submit"]')
    .filter({ hasText: /post bounty/i })
    .first();
  // Slow human scroll to the submit button instead of the snappy
  // scrollIntoViewIfNeeded (matches the rest of the recording).
  const submitY = await submitBountyBtn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, window.scrollY + r.top - window.innerHeight / 2);
  });
  await slowScrollToY(page, submitY, 1600);
  await wait(500);
  await glideAndClick(page, submitBountyBtn, { steps: 55, settle: 450 });
  try {
    await page.waitForURL(/\/bounties\/[0-9a-f-]+(?:$|\?)/i, { timeout: 15000 });
    // Post-submit hold so the analyst's just-created bounty is on
    // screen for a real beat before the outro cut. ~2.5s of recording
    // here pairs with `SCENES.video.frames = 3840` in `src/Demo.tsx`
    // (64s comp Sequence) — the comp covers the submit click + this
    // hold + a small fade-in window without any frozen-last-frame
    // dead air.
    await wait(2500);
  } catch (e) {
    // Capture the form's error state for debugging, stop the grabber
    // cleanly (we still want partial frames to inspect), then throw so
    // `make promo` halts at the source of the failure instead of
    // encoding + shipping a broken MP4 with whatever state the form
    // ended up in. The outer IIFE catches and exits non-zero.
    const errBanner = await page
      .locator('[role="alert"], .text-red-500')
      .first()
      .textContent()
      .catch(() => "n/a");
    console.error(
      `\n✗ bounty submit didn't redirect (url=${page.url()})\n  error visible: ${errBanner}`
    );
    await page.screenshot({ path: "out/debug-bounty-fail.png" });
    stopped = true;
    await grabber.catch(() => {});
    await browser.close().catch(() => {});
    throw new Error(
      "bounty submit failed — debug screenshot at out/debug-bounty-fail.png"
    );
  }

  console.log("→ stop grabber");
  stopped = true;
  const tEnd = Date.now();
  await grabber;
  await browser.close();

  const wallSeconds = (tEnd - t0) / 1000;
  const actualFps = frameIdx / wallSeconds;
  console.log(
    `\nCaptured ${frameIdx} frames in ${wallSeconds.toFixed(1)}s` +
      ` (${actualFps.toFixed(2)} fps; target ${FPS})`
  );

  // ─── Mux frames → MP4 ───────────────────────────────────────────────────
  // Encode at the MEASURED capture fps, not the target `FPS`. When the
  // grabber can't sustain the target (screenshot + JPEG encode + disk
  // write goes over the per-frame budget) the labeled framerate ends
  // up faster than the wall-clock cadence, and the recording plays
  // sped-up inside the comp. Using `actualFps` keeps playback duration
  // identical to the analyst's lived experience.
  console.log("→ encode mp4");
  const outPath = "./out/recording-submit.mp4";
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      actualFps.toFixed(3),
      "-i",
      `${FRAMES_DIR}/f_%05d.jpg`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "16",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      outPath,
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  // Block until ffmpeg actually finishes — otherwise Node exits while
  // the encoder is still writing the mp4, and the Makefile's next step
  // (`cp video/out/recording-submit.mp4 ...`) either grabs a stale file
  // from a prior run or fails with ENOENT. Exit non-zero so `make
  // promo` halts at the source of the failure instead of one step
  // downstream.
  await new Promise((resolve, reject) => {
    ff.on("exit", (code) => {
      if (code === 0) {
        console.log(`\n✓ ${outPath}`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exit ${code}`));
      }
    });
    ff.on("error", reject);
  });
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
