// Shared capture harness for the promo takes.
//
// Every recorder in this directory (record-v04.js, record-v05.js) drives a
// real Chrome through Playwright and grabs frames itself; the technique and
// the motion vocabulary are identical, only the storyboard differs. That
// common half lives here so a fix to the cursor overlay, the frame grabber or
// an ease lands in every take at once.
//
// What a recorder still owns: which pages it visits, what it clicks, the data
// it needs on the instance, and the marks it stamps.
//
// Capture technique rationale (why a polling screenshot loop rather than
// Playwright's recordVideo, why a DOM cursor, why the eased scrolls fire
// without awaiting) is documented in video/README.md.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── auth ────────────────────────────────────────────────────────────────
//
// Only takes that need a signed-in view call this. The v0.5 portfolio take
// records the anonymous, logged-out product on purpose.

async function mintCookies(api, email, password) {
  const res = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
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

async function apiCall(api, auth, method, pathname, body) {
  const res = await fetch(`${api}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: auth.cookieHeader,
      "X-CSRF-Token": auth.csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${pathname}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── cursor overlay + chrome the takes must not show ─────────────────────

const CURSOR_INIT = () => {
  const install = () => {
    // Hide the fixed version pill site-wide (it flickers on scroll and
    // stamps a dev version string across every shot).
    if (!document.getElementById("__demo_hide_beta__")) {
      const style = document.createElement("style");
      style.id = "__demo_hide_beta__";
      style.textContent =
        '[aria-label="Beta"] { display: none !important; }' +
        // The Next.js dev-tools indicator ("N" badge / "Rendering…" toast)
        // mounts in a <nextjs-portal> custom element; keep it off camera.
        "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    }
    if (document.getElementById("__demo_cursor__")) return;
    const pulseStyle = document.createElement("style");
    pulseStyle.textContent =
      "@keyframes __demo_cursor_pulse__ {" +
      "0% { transform: scale(1); } 25% { transform: scale(0.85); } 100% { transform: scale(1); } }";
    document.head.appendChild(pulseStyle);
    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor__";
    cursor.style.cssText =
      "position:fixed;left:0;top:0;width:24px;height:24px;pointer-events:none;" +
      "z-index:2147483647;will-change:transform;transform:translate(-9999px,-9999px)";
    cursor.innerHTML =
      '<div id="__demo_cursor_inner__" style="transform-origin:2px 2px;">' +
      '<svg width="24" height="24" viewBox="0 0 28 28" style="display:block;filter:drop-shadow(0 1.5px 2px rgba(0,0,0,0.55))">' +
      '<path d="M 2 2 L 2 22 L 7.5 17.5 L 11 25 L 14 23.5 L 10.5 16 L 18 16 Z" ' +
      'fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round" /></svg></div>';
    document.documentElement.appendChild(cursor);
    const inner = document.getElementById("__demo_cursor_inner__");
    document.addEventListener(
      "mousemove",
      (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      true
    );
    document.addEventListener(
      "mousedown",
      () => {
        inner.style.animation = "none";
        void inner.offsetWidth;
        inner.style.animation = "__demo_cursor_pulse__ 320ms cubic-bezier(0.4,0,0.6,1)";
      },
      true
    );
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
};

// ─── human motion helpers ────────────────────────────────────────────────

// Pacing: brisk but human. The cursor still travels visibly (~0.6s per
// glide) and every click settles before firing, but the holds are short:
// the beat breathes for a moment, not seconds, before the comp cuts.
async function glideAndClick(page, locator, { steps = 50, settle = 450 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  await wait(settle);
  await page.mouse.click(x, y);
  return { x, y };
}

// Fire-and-forget eased scroll in the page; sleep in Node so the CDP session
// stays free for the frame grabber.
async function slowScrollToY(page, targetY, durationMs = 1100) {
  await page.evaluate(
    ({ targetY, durationMs }) => {
      const startY = window.scrollY;
      const distance = targetY - startY;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + distance * eased);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },
    { targetY, durationMs }
  );
  await wait(durationMs + 60);
}

async function slowScrollToLocator(page, locator, durationMs = 1000, offset = null) {
  const y = await locator.evaluate(
    (el, off) => {
      const r = el.getBoundingClientRect();
      const centerOff = off === null ? window.innerHeight / 2 : off;
      return Math.max(0, window.scrollY + r.top - centerOff);
    },
    offset
  );
  await slowScrollToY(page, y, durationMs);
}

// Eased scroll of the map's detail side panel (a DOM overflow container, the
// close button's parent), so the proofs inside it read on camera.
async function slowScrollPanel(page, durationMs = 2300) {
  await page.evaluate((durationMs) => {
    const btn = document.querySelector('button[aria-label="Close detail panel"]');
    let el = btn && btn.parentElement;
    while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
    if (!el) return;
    const start = el.scrollTop;
    const target = el.scrollHeight - el.clientHeight;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      el.scrollTop = start + (target - start) * eased;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, durationMs);
  await wait(durationMs + 120);
}

// ─── camera eases + drag pan (the map beats' camera language) ────────────
//
// Synthetic wheel steps zoom in discrete notches and read as stutter on
// camera, so the zooms drive the maplibre camera directly (`easeTo` through
// the dev-only `window.__viditMap` handle in `components/map/Map.tsx`): one
// continuous GPU-eased motion per move, and the end state is EXACT (zoom +
// center as passed), so the pin probe replays the same calls and lands on
// identical geometry every time. The pan stays a real mouse drag: a human
// gesture with the cursor visible.
//
// The handle is a single global set by whichever <Map> mounted last, so it
// addresses the profile coverage map on /profile/<username> and the main map
// on /map without any per-page wiring.
async function easeCamera(page, { center = null, zoom = null, durationMs = 3000 }) {
  await page.evaluate(
    ({ center, zoom, durationMs }) => {
      const map = window.__viditMap;
      if (!map) throw new Error("__viditMap dev handle missing (dev build only)");
      const opts = {
        duration: durationMs,
        easing: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
        essential: true,
      };
      if (center) opts.center = center;
      if (zoom !== null) opts.zoom = zoom;
      map.easeTo(opts);
    },
    { center, zoom, durationMs }
  );
  await wait(durationMs + 400);
}

// Slow drag with a dead stop before release, so MapLibre's inertia doesn't
// throw the map and the end position stays deterministic.
async function dragPan(page, from, delta, { steps = 45 } = {}) {
  await page.mouse.move(from.x, from.y, { steps: 40 });
  await wait(260);
  await page.mouse.down();
  await wait(140);
  await page.mouse.move(from.x + delta.dx, from.y + delta.dy, { steps });
  await wait(300);
  await page.mouse.up();
}

// Eased scroll that works whatever the scrolling ancestor is (window or an
// inner container): native smooth scrollIntoView, centered.
async function smoothScrollIntoView(page, locator, settleMs = 1200) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await wait(settleMs);
}

// Click an EntityCard through its stretched link. Parts of the card's
// surface (byline, badge, some spans) hit-test OUTSIDE the link, so probe a
// few points and click one that resolves into an <a> whose href carries the
// event id. One click only; callers follow with a patient waitForURL (the
// dev server compiles a route on first nav, which is a pending navigation,
// not a miss).
async function glideClickStretchedCard(page, locator, eventId) {
  let box = await locator.boundingBox();
  if (!box) throw new Error("card not visible");
  const vp = page.viewportSize();
  if (box.y < 0 || box.y + box.height > vp.height) {
    await smoothScrollIntoView(page, locator, 1600);
    box = await locator.boundingBox();
    if (!box || box.y < 0 || box.y + box.height > vp.height) {
      throw new Error("card still out of the viewport after scroll");
    }
  }
  let pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.35], [0.7, 0.4], [0.5, 0.78], [0.25, 0.6]]) {
    const p = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    const hitsLink = await page.evaluate(
      ({ x, y, id }) => {
        const e = document.elementFromPoint(x, y);
        const a = e && e.closest("a");
        return !!(a && (a.getAttribute("href") || "").includes(id));
      },
      { ...p, id: eventId }
    );
    if (hitsLink) {
      pt = p;
      break;
    }
  }
  await page.mouse.move(pt.x, pt.y, { steps: 75 });
  await wait(650);
  await page.mouse.click(pt.x, pt.y);
}

// ─── one recorded clip ───────────────────────────────────────────────────

// Build the clip recorder a script uses. `clipsDir` is where the mp4 lands
// (Remotion's staticFile root) and `metaPath` the timing sidecar
// gen-clips-manifest.js compiles into src/clips-manifest.ts.
function createRecorder({ clipsDir, metaPath, outDir, fps = 60, dpr = 2 }) {
  // Opens a fresh context (cookies optional), hands the page to `flow`, and
  // encodes the grabbed frames into <clipsDir>/<name>.mp4 at the measured
  // fps. `flow` gets a `rec` handle: rec.start() begins capture, rec.mark(k)
  // stamps a named timestamp (seconds since capture start) for the comp's
  // windowing, rec.stop() ends capture.
  return async function recordClip(name, { cookies = null }, flow) {
    const framesDir = path.join(outDir, `rec-${name}-frames`);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(clipsDir, { recursive: true });

    // --use-angle=metal: WebGL on the real GPU. The default headless
    // SwiftShader (software GL) starves the whole capture path on the map
    // (~6 fps through Playwright's screenshot, ~20 raw); on Metal the raw
    // CDP capture below sustains ~33 fps at native 1080p during a camera
    // ease and more on DOM pages.
    const browser = await chromium.launch({
      headless: true,
      // --force-device-scale-factor: the raw CDP captureScreenshot grabs the
      // SURFACE, which ignores Playwright's emulated deviceScaleFactor (only
      // Playwright's own screenshot path re-renders at the override). Without
      // this flag every take captured at 720p and the encode upscaled it.
      args: ["--use-angle=metal", `--force-device-scale-factor=${dpr}`],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      // DPR 2 captures 2560x1440 device px: the comp shows the chrome at
      // 1370 CSS px of a 1920 frame, so the downscale headroom is what makes
      // the capture read sharp. Costs capture fps (VFR encoding absorbs it).
      deviceScaleFactor: dpr,
    });
    if (cookies) await ctx.addCookies(cookies);
    await ctx.addInitScript(CURSOR_INIT);
    const page = await ctx.newPage();

    // Capture: raw CDP Page.captureScreenshot in a polling loop (bypasses
    // Playwright's per-shot stability waits, which throttle to ~6 fps while
    // the map animates), each frame stamped with its real capture time. The
    // encode honours those timestamps exactly (concat demuxer with per-frame
    // durations, resampled to CFR 60), so motion plays back at the pace the
    // page painted it; the previous average-fps encode is what read as
    // stutter.
    const cdp = await ctx.newCDPSession(page);
    // No `clip`: its coordinates are DOCUMENT-relative, so any scrolled page
    // captures the (unrendered, black) document top instead of the viewport.
    const CAPTURE = { format: "jpeg", quality: 94, optimizeForSpeed: true };
    let frameIdx = 0;
    const frameTs = []; // epoch seconds per captured frame
    let capturing = false;
    let started = false;
    let t0 = null;
    let grabber = Promise.resolve();
    const marks = {};
    const timeMarkKeys = new Set();

    const rec = {
      start() {
        if (started) return;
        started = true;
        capturing = true;
        grabber = (async () => {
          const interval = 1000 / fps;
          while (capturing) {
            const loopT = Date.now();
            try {
              const { data } = await cdp.send("Page.captureScreenshot", CAPTURE);
              const ts = Date.now() / 1000;
              if (t0 === null) t0 = ts;
              fs.writeFileSync(
                path.join(framesDir, `f_${String(frameIdx++).padStart(5, "0")}.jpg`),
                Buffer.from(data, "base64")
              );
              frameTs.push(ts);
            } catch (e) {
              if (capturing) console.warn("grab failed:", e.message);
              break;
            }
            const sleepMs = interval - (Date.now() - loopT);
            if (sleepMs > 0) await wait(sleepMs);
          }
        })();
      },
      mark(key) {
        marks[key] = Date.now() / 1000; // same epoch base as frame timestamps
        timeMarkKeys.add(key);
        console.log(`  · mark ${key}`);
      },
      // Arbitrary numeric mark (geometry, counts), not a timestamp.
      set(key, value) {
        marks[key] = Number(value.toFixed ? value.toFixed(3) : value);
      },
      async stop() {
        capturing = false;
        await grabber;
      },
    };

    console.log(`\n━━ clip: ${name}`);
    try {
      await flow(page, rec, ctx);
    } finally {
      await rec.stop();
      await browser.close();
    }

    if (frameIdx < 2 || t0 === null) throw new Error(`clip ${name}: no frames captured`);
    const TAIL = 0.4; // seconds the final frame holds
    const durationSec = frameTs[frameIdx - 1] - t0 + TAIL;
    console.log(
      `  captured ${frameIdx} frames over ${durationSec.toFixed(1)}s (VFR, ` +
        `${(frameIdx / durationSec).toFixed(1)} fps avg)`
    );

    // Concat list with true per-frame durations (the demuxer requires the
    // last file repeated after its duration entry).
    const lines = [];
    for (let i = 0; i < frameIdx; i++) {
      const d = i + 1 < frameIdx ? frameTs[i + 1] - frameTs[i] : TAIL;
      lines.push(`file 'f_${String(i).padStart(5, "0")}.jpg'`);
      lines.push(`duration ${Math.max(d, 1 / 120).toFixed(4)}`);
    }
    lines.push(`file 'f_${String(frameIdx - 1).padStart(5, "0")}.jpg'`);
    fs.writeFileSync(path.join(framesDir, "list.txt"), lines.join("\n") + "\n");

    const outPath = path.join(clipsDir, `${name}.mp4`);
    await new Promise((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", path.join(framesDir, "list.txt"),
          "-vf", "fps=60,scale=2560:1440:flags=lanczos",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "16",
          outPath,
        ],
        { stdio: ["ignore", "ignore", "inherit"] }
      );
      ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
      ff.on("error", reject);
    });
    console.log(`  ✓ ${outPath}`);

    // Marks share the frame timestamps' epoch base, so the mp4 timeline
    // position is a plain offset from the first frame.
    const remapped = {};
    for (const [key, value] of Object.entries(marks)) {
      if (!timeMarkKeys.has(key)) {
        remapped[key] = value; // geometry / count marks pass through
        continue;
      }
      remapped[key] = Number(Math.min(Math.max(value - t0, 0), durationSec).toFixed(3));
      console.log(`  · mark ${key} → ${remapped[key].toFixed(2)}s (mp4)`);
    }

    // Merge into meta.json (other clips' entries survive partial re-records).
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
    meta[name] = {
      fps: 60,
      durationSec: Number(durationSec.toFixed(3)),
      marks: remapped,
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  };
}

module.exports = {
  wait,
  mintCookies,
  apiCall,
  CURSOR_INIT,
  glideAndClick,
  slowScrollToY,
  slowScrollToLocator,
  slowScrollPanel,
  easeCamera,
  dragPan,
  smoothScrollIntoView,
  glideClickStretchedCard,
  createRecorder,
};
