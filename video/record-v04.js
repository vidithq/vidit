// v0.4 promo: real-recording capture, one clip per storyboard beat.
//
// Unlike record-submit.js (one continuous take), this records SEPARATE clips
// so the Remotion comp (`src/PromoV04.tsx`) can pace each beat and slot the
// maintainer's real X screen captures in between:
//
//   demo.mp4       the WHOLE in-app demo, one continuous take: map (camera
//                  eases, pin, proofs) → sidemenu Submit → bulk import →
//                  scan → queue → review + submit → the published detail.
//   bot-embed.mp4  the bot beat's X-embed plate.
//
// Clips land in public/clips/ (where Remotion's staticFile reads them) plus
// a meta.json carrying each clip's measured fps + in-take event timestamps,
// which `gen-clips-manifest.js` turns into the comp's timing manifest.
//
// Capture technique (polling page.screenshot at 60fps, DOM cursor overlay,
// measured-fps encode) is inherited from record-submit.js; see the rationale
// comments there.
//
// Usage: node record-v04.js [demo,bot-embed]  (default: both)

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { ensureMediaCache, PROOF_IMG } = require("./gen-archive");

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const FPS = 60;
const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");
const HERO_PATH = path.join(__dirname, "out", "hero.json");

// The recorded takes import the maintainer's REAL X export (their published
// geolocation work, real media), copied read-only from the repo root. The
// synthetic generator (gen-archive.js) stays for CI / reproducibility, but
// what's on camera is the real archive.
const REAL_ARCHIVE_SOURCE = path.join(__dirname, "..", "Vidit stuff.zip");
const REAL_ARCHIVE = path.join(__dirname, "out", "real-archive.zip");
function ensureRealArchive() {
  if (!fs.existsSync(REAL_ARCHIVE_SOURCE)) {
    throw new Error(`real archive not found at ${REAL_ARCHIVE_SOURCE}`);
  }
  const src = fs.statSync(REAL_ARCHIVE_SOURCE);
  if (!fs.existsSync(REAL_ARCHIVE) || fs.statSync(REAL_ARCHIVE).size !== src.size) {
    fs.copyFileSync(REAL_ARCHIVE_SOURCE, REAL_ARCHIVE);
  }
  return REAL_ARCHIVE;
}

// The real tweet the bot beat's X embed renders (same analyst + tweet the
// 0.3 pipeline used; see record-submit.js TWEET_URL).
const BOT_EMBED_TWEET = "https://x.com/geo27752/status/2060086984513626223";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── auth ────────────────────────────────────────────────────────────────

async function mintCookies(email, password) {
  const res = await fetch(`${API}/auth/login`, {
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

async function api(auth, method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
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

// ─── cursor + human motion helpers (same approach as record-submit.js) ───

const CURSOR_INIT = () => {
  const install = () => {
    // Hide the fixed version pill site-wide (it flickers on scroll and
    // stamps a dev version string across every shot).
    if (!document.getElementById("__demo_hide_beta__")) {
      const style = document.createElement("style");
      style.id = "__demo_hide_beta__";
      style.textContent =
        '[aria-label="Closed beta"] { display: none !important; }' +
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
// stays free for the frame grabber (see record-submit.js for why).
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

// ─── camera eases + drag pan (the map beat's camera language) ────────────
//
// Synthetic wheel steps zoom in discrete notches and read as stutter on
// camera, so the zooms drive the maplibre camera directly (`easeTo` through
// the dev-only `window.__viditMap` handle in `components/map/Map.tsx`): one
// continuous GPU-eased motion per move, and the end state is EXACT (zoom +
// center as passed), so the pin probe replays the same calls and lands on
// identical geometry every time. The pan stays a real mouse drag: a human
// gesture with the cursor visible.
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

// Pan the hero pin toward the open-map center, always visibly.
function panDeltaFor(pin) {
  const dx = Math.max(-130, Math.min(130, 600 - pin.x));
  const dy = Math.max(-95, Math.min(95, 340 - pin.y));
  return {
    dx: Math.abs(dx) < 55 ? (dx < 0 ? -55 : 55) : Math.round(dx),
    dy: Math.abs(dy) < 40 ? (dy < 0 ? -40 : 40) : Math.round(dy),
  };
}

// ─── the mock macOS open dialog for the import beat ──────────────────────
//
// Headless Chromium can't show the real file chooser, so the recorded pick
// is a Finder-style open dialog injected into the page: dark vibrancy, the
// traffic lights, a Favourites sidebar, a Downloads list with the real
// archive in it. The cursor glides to the zip, double-clicks, the dialog
// closes, and the real input is fed off camera right after.
async function injectFinder(page, zipName, zipBytes) {
  const zipSize = `${(zipBytes / (1024 * 1024)).toFixed(1)} MB`;
  await page.evaluate(
    ({ zipName, zipSize }) => {
      const host = document.createElement("div");
      host.id = "__demo_finder__";
      const folderIcon =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="#4da2ff" style="flex:none"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.1c.7 0 1.4.3 1.9.8l1 1.2h6A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
      const clockIcon =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4da2ff" stroke-width="2" style="flex:none"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
      const gridIcon =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="#4da2ff" style="flex:none"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
      const airdropIcon =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4da2ff" stroke-width="2" style="flex:none"><circle cx="12" cy="14" r="2.4" fill="#4da2ff" stroke="none"/><path d="M7.7 10.2a6 6 0 0 1 8.6 0"/><path d="M5 7.5a10 10 0 0 1 14 0"/></svg>';
      const fileIcons = {
        zip: '<svg width="17" height="17" viewBox="0 0 24 24" style="flex:none"><path d="M5 3.5A1.5 1.5 0 0 1 6.5 2h8L19 6.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5z" fill="#d8d8dc"/><path d="M14.5 2 19 6.5h-3.4a1.1 1.1 0 0 1-1.1-1.1z" fill="#a9a9b0"/><path d="M11 3h2v1.5h-2zM11 5.6h2v1.5h-2zM11 8.2h2v1.5h-2zM10.4 10.8h3.2v3.4a1.6 1.6 0 1 1-3.2 0z" fill="#7c7c85"/></svg>',
        img: '<svg width="17" height="17" viewBox="0 0 24 24" style="flex:none"><rect x="3.5" y="5" width="17" height="14" rx="1.6" fill="#e6e6ea"/><circle cx="8.6" cy="9.6" r="1.6" fill="#f7b955"/><path d="m5.5 17 4.2-4.6 2.8 2.9 3-3.6 3.5 5.3z" fill="#54b46a"/></svg>',
        pdf: '<svg width="17" height="17" viewBox="0 0 24 24" style="flex:none"><path d="M5 3.5A1.5 1.5 0 0 1 6.5 2h8L19 6.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5z" fill="#e8e8ec"/><path d="M14.5 2 19 6.5h-3.4a1.1 1.1 0 0 1-1.1-1.1z" fill="#bfbfc6"/><rect x="6.6" y="12.4" width="10.8" height="6" rx="1" fill="#e5484d"/><text x="12" y="17" font-size="4.6" font-weight="700" fill="#fff" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif">PDF</text></svg>',
        txt: '<svg width="17" height="17" viewBox="0 0 24 24" style="flex:none"><path d="M5 3.5A1.5 1.5 0 0 1 6.5 2h8L19 6.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5z" fill="#e8e8ec"/><path d="M14.5 2 19 6.5h-3.4a1.1 1.1 0 0 1-1.1-1.1z" fill="#bfbfc6"/><path d="M7.5 10h9M7.5 12.6h9M7.5 15.2h6.4" stroke="#9a9aa2" stroke-width="1.1"/></svg>',
      };
      const rows = [
        { name: zipName, size: zipSize, kind: "ZIP archive", date: "Today at 09:41", icon: "zip", id: "__finder_zip_row__" },
        { name: "Screenshot 2026-07-18 at 09.02.14.png", size: "1.2 MB", kind: "PNG image", date: "Today at 09:02", icon: "img" },
        { name: "IMG_4821.jpeg", size: "3.1 MB", kind: "JPEG image", date: "Yesterday at 18:47", icon: "img" },
        { name: "sentinel-2_L2A_T36SXA.tiff", size: "214.6 MB", kind: "TIFF image", date: "Yesterday at 11:20", icon: "img" },
        { name: "flight-briefing.pdf", size: "812 KB", kind: "PDF document", date: "15 July 2026 at 21:04", icon: "pdf" },
        { name: "field-notes.txt", size: "6 KB", kind: "Plain text", date: "14 July 2026 at 08:13", icon: "txt" },
      ];
      const sideItems = [
        { label: "AirDrop", icon: airdropIcon },
        { label: "Recents", icon: clockIcon },
        { label: "Applications", icon: gridIcon },
        { label: "Desktop", icon: folderIcon },
        { label: "Documents", icon: folderIcon },
        { label: "Downloads", icon: folderIcon, active: true },
      ];
      host.innerHTML = `
<style>
#__demo_finder__ * { box-sizing: border-box; margin: 0; padding: 0; }
#__demo_finder__ { position: fixed; inset: 0; z-index: 2147483600;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased; }
#__finder_backdrop__ { position: absolute; inset: 0; background: rgba(0,0,0,0.3);
  opacity: 0; transition: opacity 180ms ease-out; }
#__finder_win__ { position: absolute; left: 50%; top: 96px; width: 700px;
  margin-left: -350px; border-radius: 11px; overflow: hidden;
  background: rgba(38,38,41,0.9); backdrop-filter: blur(26px) saturate(1.3);
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 26px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(0,0,0,0.6);
  color: #e7e7ea; font-size: 13px;
  opacity: 0; transform: scale(0.97) translateY(6px);
  transition: opacity 190ms ease-out, transform 190ms ease-out; }
#__demo_finder__.on #__finder_backdrop__ { opacity: 1; }
#__demo_finder__.on #__finder_win__ { opacity: 1; transform: scale(1) translateY(0); }
#__demo_finder__.off #__finder_backdrop__ { opacity: 0; }
#__demo_finder__.off #__finder_win__ { opacity: 0; transform: scale(0.98); transition-duration: 150ms; }
.fx-titlebar { display: flex; align-items: center; height: 48px; padding: 0 14px;
  border-bottom: 1px solid rgba(0,0,0,0.4); background: rgba(255,255,255,0.03); }
.fx-lights { display: flex; gap: 8px; width: 120px; }
.fx-lights span { width: 12px; height: 12px; border-radius: 50%; }
.fx-lights .r { background: #ff5f57; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.2); }
.fx-lights .y { background: #febc2e; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.2); }
.fx-lights .g { background: #28c840; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.2); }
.fx-title { flex: 1; display: flex; align-items: center; justify-content: center;
  gap: 7px; font-weight: 600; font-size: 13.5px; color: #ececef; }
.fx-search { width: 120px; display: flex; justify-content: flex-end; }
.fx-search div { display: flex; align-items: center; gap: 5px; height: 24px;
  padding: 0 9px; border-radius: 6px; background: rgba(255,255,255,0.08);
  color: #9d9da4; font-size: 12px; }
.fx-body { display: flex; height: 318px; }
.fx-side { width: 168px; padding: 10px 8px; background: rgba(28,28,31,0.72);
  border-right: 1px solid rgba(0,0,0,0.42); }
.fx-side-label { font-size: 11px; font-weight: 600; color: #8b8b92;
  padding: 2px 8px 5px; }
.fx-side-item { display: flex; align-items: center; gap: 7px; height: 26px;
  padding: 0 8px; border-radius: 6px; font-size: 12.5px; color: #d9d9dd; }
.fx-side-item.active { background: rgba(255,255,255,0.14); }
.fx-list { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.fx-cols { display: flex; height: 26px; align-items: center; font-size: 11px;
  color: #97979e; border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 0 12px; }
.fx-row { display: flex; height: 27px; align-items: center; padding: 0 12px;
  font-size: 12.5px; color: #e4e4e8; }
.fx-row:nth-child(odd) { background: rgba(255,255,255,0.028); }
.fx-row.sel { background: #2f6fed; color: #fff; }
.fx-row.sel .fx-dim { color: rgba(255,255,255,0.8); }
.fx-c-name { flex: 1 1 0; min-width: 0; display: flex; align-items: center;
  gap: 8px; overflow: hidden; white-space: nowrap; }
.fx-c-name, .fx-c-name * { text-overflow: ellipsis; }
.fx-c-size { flex: 0 0 84px; text-align: right; white-space: nowrap; }
.fx-c-kind { flex: 0 0 118px; padding-left: 22px; white-space: nowrap;
  overflow: hidden; }
.fx-c-date { flex: 0 0 150px; padding-left: 16px; white-space: nowrap;
  overflow: hidden; }
.fx-dim { color: #a3a3aa; }
.fx-foot { display: flex; align-items: center; gap: 10px; height: 52px;
  padding: 0 16px; border-top: 1px solid rgba(0,0,0,0.4);
  background: rgba(255,255,255,0.02); }
.fx-format { flex: 1; font-size: 12px; color: #8f8f96; }
.fx-btn { height: 25px; padding: 0 16px; border-radius: 6px; border: none;
  font-size: 13px; font-family: inherit; color: #fff;
  background: rgba(255,255,255,0.16);
  box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.18); }
.fx-btn.primary { background: linear-gradient(#3f83f8, #2f6fed);
  opacity: 0.45; }
.fx-btn.primary.armed { opacity: 1; }
</style>
<div id="__finder_backdrop__"></div>
<div id="__finder_win__">
  <div class="fx-titlebar">
    <div class="fx-lights"><span class="r"></span><span class="y"></span><span class="g"></span></div>
    <div class="fx-title">${folderIcon} Downloads</div>
    <div class="fx-search"><div><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9d9da4" stroke-width="2.4"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg> Search</div></div>
  </div>
  <div class="fx-body">
    <div class="fx-side">
      <div class="fx-side-label">Favourites</div>
      ${sideItems
        .map(
          (s) =>
            `<div class="fx-side-item${s.active ? " active" : ""}">${s.icon} ${s.label}</div>`
        )
        .join("")}
    </div>
    <div class="fx-list">
      <div class="fx-cols"><span class="fx-c-name" style="padding-left:25px">Name</span><span class="fx-c-size">Size</span><span class="fx-c-kind">Kind</span><span class="fx-c-date">Date Added</span></div>
      ${rows
        .map(
          (r) =>
            `<div class="fx-row"${r.id ? ` id="${r.id}"` : ""}>` +
            `<span class="fx-c-name">${fileIcons[r.icon]} ${r.name}</span>` +
            `<span class="fx-c-size fx-dim">${r.size}</span>` +
            `<span class="fx-c-kind fx-dim">${r.kind}</span>` +
            `<span class="fx-c-date fx-dim">${r.date}</span></div>`
        )
        .join("")}
    </div>
  </div>
  <div class="fx-foot">
    <span class="fx-format">Format: ZIP archive</span>
    <button class="fx-btn">Cancel</button>
    <button class="fx-btn primary" id="__finder_open__">Open</button>
  </div>
</div>`;
      document.documentElement.appendChild(host);
      // Real selection behaviour: a click on any row highlights it and arms
      // the Open button, like Finder.
      host.querySelectorAll(".fx-row").forEach((row) => {
        row.addEventListener("mousedown", () => {
          host.querySelectorAll(".fx-row").forEach((r) => r.classList.remove("sel"));
          row.classList.add("sel");
          document.getElementById("__finder_open__").classList.add("armed");
        });
      });
      requestAnimationFrame(() => host.classList.add("on"));
    },
    { zipName, zipSize }
  );
}

async function closeFinder(page) {
  await page.evaluate(() => {
    const host = document.getElementById("__demo_finder__");
    if (!host) return;
    host.classList.remove("on");
    host.classList.add("off");
    setTimeout(() => host.remove(), 180);
  });
  await wait(260);
}

// ─── one recorded clip ───────────────────────────────────────────────────

// Opens a fresh context (cookies optional), hands the page to `flow`, and
// encodes the grabbed frames into public/clips/<name>.mp4 at the measured
// fps. `flow` gets a `rec` handle: rec.start() begins capture, rec.mark(k)
// stamps a named timestamp (seconds since capture start) for the comp's
// windowing, rec.stop() ends capture.
async function recordClip(name, { cookies = null }, flow) {
  const framesDir = path.join(__dirname, "out", `rec-${name}-frames`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(CLIPS_DIR, { recursive: true });

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
    args: ["--use-angle=metal", `--force-device-scale-factor=${CAPTURE_DPR}`],
  });
  // DPR 1.5 → native 1920×1080 frames: exactly the comp's resolution.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    // DPR 2 captures 2560x1440 device px: the comp shows the chrome at
    // 1370 CSS px of a 1920 frame, so the downscale headroom is what makes
    // the capture read sharp. Costs capture fps (VFR encoding absorbs it).
    deviceScaleFactor: CAPTURE_DPR,
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
  // Plain capture returns the viewport at CSS size (1280×720); the encode
  // upscales to 1080p, and the comp displays at 1370 wide, so the loss is
  // negligible.
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
        const interval = 1000 / FPS;
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

  const outPath = path.join(CLIPS_DIR, `${name}.mp4`);
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
  const meta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, "utf8")) : {};
  meta[name] = {
    fps: 60,
    durationSec: Number(durationSec.toFixed(3)),
    marks: remapped,
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

// ─── orange-pin detection on the map screenshot ──────────────────────────
//
// The map renders pins on a WebGL canvas, so there is no DOM to target. The
// accent-orange pin colour (#f97316) doesn't occur on the dark basemap, so a
// pixel scan of a screenshot finds every pin. ffmpeg decodes the PNG to raw
// RGB (no image-decoding dependency in Node needed).
// Two pin colours exist on the canvas: the submitted base (#f97316) and the
// lighter machine-`detected` stop (#fdba74, palette.ts). Each gets its own
// pixel predicate; neither occurs on the dark basemap.
const PIN_PREDICATES = {
  base: (r, g, b) => r > 225 && g > 85 && g < 150 && b < 70,
  detected: (r, g, b) => r > 235 && g > 160 && g < 215 && b > 85 && b < 150,
};

function findOrangeBlobs(pngBuffer, width, height, mode = "base") {
  const isPin = PIN_PREDICATES[mode];
  const dec = spawnSync(
    "ffmpeg",
    ["-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { input: pngBuffer, maxBuffer: width * height * 3 + 1024 }
  );
  const rgb = dec.stdout;
  if (!rgb || rgb.length < width * height * 3) throw new Error("pixel decode failed");
  // Union pixels into coarse buckets, then merge adjacent buckets into blobs.
  const CELL = 16;
  const cells = new Map(); // cellKey -> {count, sumX, sumY}
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      if (isPin(r, g, b)) {
        const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        const c = cells.get(key) || { count: 0, sumX: 0, sumY: 0 };
        c.count++; c.sumX += x; c.sumY += y;
        cells.set(key, c);
      }
    }
  }
  // Merge 8-connected cells.
  const seen = new Set();
  const blobs = [];
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    const [cx, cy] = key.split(",").map(Number);
    const stack = [[cx, cy]];
    let count = 0, sumX = 0, sumY = 0;
    while (stack.length) {
      const [ax, ay] = stack.pop();
      const k = `${ax},${ay}`;
      if (seen.has(k) || !cells.has(k)) continue;
      seen.add(k);
      const c = cells.get(k);
      count += c.count; sumX += c.sumX; sumY += c.sumY;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) stack.push([ax + dx, ay + dy]);
    }
    if (count > 20) blobs.push({ x: sumX / count, y: sumY / count, area: count });
  }
  return blobs;
}

// Screenshot → pin candidates in CSS px, restricted to the open map area
// (excludes the left sidebar, the filter button region, the bottom controls
// and the right edge where the detail panel will open).
// Must match the recording context's deviceScaleFactor: the pixel scan
// decodes device px and maps candidates back to CSS px through it.
const CAPTURE_DPR = 2;

async function findPinCandidates(page, mode = "base") {
  const png = await page.screenshot({ type: "png" });
  const blobs = findOrangeBlobs(png, 1280 * CAPTURE_DPR, 720 * CAPTURE_DPR, mode);
  return blobs
    .map((b) => ({ x: b.x / CAPTURE_DPR, y: b.y / CAPTURE_DPR, area: b.area }))
    .filter(
      (b) =>
        // Open map area: outside the sidebar/filter region, above the
        // bottom-left controls (x<170 only), clear of the right edge where
        // the detail panel opens. The recorded pages hide the beta pill and
        // dev badge, so the bottom band is free up to y≈685.
        b.x > 170 && b.x < 900 && b.y > 90 && b.y < 685 &&
        // pin ≈ r6 CSS ≈ 12px device radius at DPR 2 ≈ 450 px²; counted
        // cluster circles start around 1800. The cap scales with DPR².
        b.area < 230 * CAPTURE_DPR * CAPTURE_DPR
    );
}

// ─── hero event for the map beat ─────────────────────────────────────────
//
// The map beat opens a REAL geolocation: one draft from the maintainer's
// real archive, promoted at setup through the same geolocate endpoint the
// UI uses. Its id + title persist in out/hero.json so re-runs reuse it.

// Web-mercator screen projection helpers. Approximate under the globe
// projection but close enough to order pin candidates for the probe.
function mercProject(lat, lng, zoom) {
  const world = 512 * Math.pow(2, zoom);
  return {
    x: ((lng + 180) / 360) * world,
    y:
      ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) *
      world,
  };
}
function screenAt(lat, lng, zoom) {
  const c = mercProject(48.5, 35.0, zoom);
  const p = mercProject(lat, lng, zoom);
  return { x: 640 + (p.x - c.x), y: 360 + (p.y - c.y) };
}

function isoToDatetimeLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  );
}

function proofHasImage(proof) {
  let found = false;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "image") found = true;
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(proof);
  return found;
}

// Region-fit conflict for the maintainer's real work (Levant vs elsewhere).
function pickConflictId(conflicts, lng) {
  const byName = (re) => conflicts.find((c) => re.test(c.name));
  if (lng !== null && lng < 40) {
    return (byName(/gaza/i) || byName(/other/i) || conflicts[0])?.id;
  }
  return (byName(/other/i) || conflicts[0])?.id;
}

// Upload a zip through the real presign → staging POST → JSON enqueue flow
// (the same three calls the frontend makes since the direct-to-S3 rework)
// and wait for the worker to finish. Setup-only (off camera); the recorded
// import take re-runs the same flow in the UI.
async function importArchiveViaApi(auth, zipPath, label) {
  console.log(`→ importing ${label} via the API (setup, off camera)`);
  const presign = await api(auth, "POST", "/events/import-archive/presign", {});
  const fd = new FormData();
  for (const [k, v] of Object.entries(presign.upload.fields)) fd.append(k, v);
  fd.append(
    "file",
    new Blob([fs.readFileSync(zipPath)], { type: "application/zip" }),
    path.basename(zipPath)
  );
  const up = await fetch(presign.upload.url, {
    method: "POST",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    body: fd,
  });
  if (!up.ok) throw new Error(`staging upload: ${up.status} ${await up.text()}`);
  const job = await api(auth, "POST", "/events/import-archive", {
    upload_key: presign.upload_key,
  });
  for (let i = 0; i < 240; i++) {
    await wait(3000);
    const j = await api(auth, "GET", `/events/import-archive/${job.id}`);
    if (j.status === "done" || j.status === "failed") {
      console.log(
        `  import ${j.status}: created ${j.created}, skipped ${j.skipped}, failed ${j.failed}`
      );
      if (j.status === "failed") throw new Error(`${label} import failed`);
      return j;
    }
  }
  throw new Error(`${label} import timed out`);
}

// The author handle inside an x.com/twitter.com status URL, lowercased.
function handleFromSourceUrl(url) {
  const m = /(?:x|twitter)\.com\/([^/]+)\//.exec(url || "");
  return m ? m[1].toLowerCase() : null;
}

// Close open drafts. With `onlyHandle`, only drafts whose source tweet
// belongs to that handle close (the maintainer's own posts, so the on-camera
// import re-creates them fresh) and the seeded field survives; without it,
// everything closes. Spared rows keep pages non-empty, so this collects a
// full pass of ids before closing instead of spinning on page 1.
async function closeOpenDetections(auth, onlyHandle = null) {
  let closed = 0;
  for (;;) {
    const ids = [];
    for (let p = 1; ; p++) {
      const page = await api(auth, "GET", `/events/detections?page=${p}&per_page=50`);
      for (const it of page.items) {
        if (onlyHandle && handleFromSourceUrl(it.source_url) !== onlyHandle) continue;
        ids.push(it.id);
      }
      if (p * 50 >= page.total) break;
    }
    if (ids.length === 0) return closed;
    for (const id of ids) {
      await api(auth, "POST", `/events/${id}/close`, {
        close_reason: "Cleared before re-recording the demo take.",
      });
      closed++;
    }
  }
}

// Seed the pin field: the full analyst export (~600 real detections) makes
// the map open on a dense field and the closing author-filter beat show the
// work at scale. Idempotent: a field already seeded (from a previous run)
// skips the upload. Fail-soft when the zip is absent from ~/Downloads.
const BIG_ARCHIVE_SOURCE = path.join(
  process.env.HOME || "",
  "Downloads",
  "twitter-2026-07.zip"
);

async function seedBigArchive(auth) {
  const p1 = await api(auth, "GET", "/events/detections?page=1&per_page=1");
  if (p1.total > 300) {
    console.log(`→ big-archive seed already present (${p1.total} open detections)`);
    return;
  }
  if (!fs.existsSync(BIG_ARCHIVE_SOURCE)) {
    console.warn(`  big archive not found at ${BIG_ARCHIVE_SOURCE}; the pin field stays thin`);
    return;
  }
  await importArchiveViaApi(auth, BIG_ARCHIVE_SOURCE, "the full analyst export");
}

// Promote one rich real draft (media + coordinate + source) to `geolocated`
// through the same endpoint the edit form uses, filling the human's part
// (conflict, capture source, a proof image when the draft has none).
async function promoteHeroDraft(auth) {
  const list = await api(auth, "GET", "/events/detections?page=1&per_page=50");
  const ranked = list.items
    .filter((it) => it.event_coords && it.media && it.media.length > 0)
    .sort((a, b) => (b.media?.length ?? 0) - (a.media?.length ?? 0));
  const draft = ranked[0];
  if (!draft) throw new Error("no promotable draft found in the real archive import");
  const detail = await api(auth, "GET", `/events/${draft.id}`);
  const [tags, conflicts] = await Promise.all([
    api(auth, "GET", "/tags?curated=true"),
    api(auth, "GET", "/conflicts"),
  ]);
  const capture =
    tags.find((t) => t.category === "capture_source" && t.name === "Unknown") ||
    tags.find((t) => t.category === "capture_source");
  const conflictId = pickConflictId(conflicts, detail.event_coords?.lng ?? null);

  const fd = new FormData();
  fd.append("title", detail.title);
  fd.append("lat", String(detail.event_coords.lat));
  fd.append("lng", String(detail.event_coords.lng));
  fd.append("source_url", detail.source_url || detail.detected_from_url || "");
  fd.append("event_date", detail.event_date || "2026-07-01");
  fd.append(
    "source_posted_at",
    isoToDatetimeLocal(detail.source_posted_at) ||
      isoToDatetimeLocal(detail.detected_post_at) ||
      "2026-07-01T12:00"
  );
  let proof = detail.proof || { type: "doc", content: [] };
  if (!proofHasImage(proof)) {
    ensureMediaCache(); // guarantees the satellite proof still exists
    proof = {
      ...proof,
      content: [
        ...(proof.content || []),
        { type: "image", attrs: { src: "placeholder://proof-sat.jpg" } },
      ],
    };
    fd.append(
      "proof_files",
      new Blob([fs.readFileSync(PROOF_IMG)], { type: "image/jpeg" }),
      "proof-sat.jpg"
    );
  }
  fd.append("proof", JSON.stringify(proof));
  if (conflictId) fd.append("conflict_ids", JSON.stringify([conflictId]));
  if (capture) {
    fd.append(
      "tag_ids",
      JSON.stringify([...new Set([...(detail.tags || []).map((t) => t.id), capture.id])])
    );
  }
  const res = await fetch(`${API}/events/${draft.id}/geolocate`, {
    method: "POST",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    body: fd,
  });
  if (!res.ok) throw new Error(`geolocate hero: ${res.status} ${await res.text()}`);
  const hero = await res.json();
  fs.writeFileSync(HERO_PATH, JSON.stringify({ id: hero.id, title: hero.title }, null, 2));
  console.log(`  ✓ hero promoted: ${hero.title}`);
  return hero;
}

async function findHeroEvent(auth) {
  if (fs.existsSync(HERO_PATH)) {
    const { id } = JSON.parse(fs.readFileSync(HERO_PATH, "utf8"));
    const hero = await api(auth, "GET", `/events/${id}`).catch(() => null);
    if (hero && hero.status === "geolocated") return hero;
  }
  return null;
}

// Residue sweep (dev DB, off camera). Every recorded run closes the
// re-imported drafts and publishes one event, so closed/geolocated copies
// accumulate (500+ observed) and outrank the fresh publish in the profile's
// Recent submissions (event_date desc, top 5). Soft-delete everything but
// the hero before a take. Direct SQL because the admin delete endpoint is
// rate-limited to 60/hour. Fail-soft: without docker the take still runs,
// the profile ending is just at risk.
function sweepResidues(heroId) {
  const sql =
    "UPDATE events e SET deleted_at = now() FROM users u " +
    "WHERE u.id = e.owner_id AND u.username = 'analyst' AND e.deleted_at IS NULL " +
    `  AND e.status IN ('closed','geolocated') AND e.id <> '${heroId}';`;
  const res = spawnSync("docker", ["exec", "vidit-db", "psql", "-U", "vision", "-d", "vision", "-c", sql], {
    encoding: "utf8",
  });
  if (res.status === 0) {
    console.log(`  residue sweep: ${(res.stdout || "").trim()}`);
  } else {
    console.warn(`  residue sweep skipped (${(res.stderr || "docker unavailable").trim()})`);
  }
}

// The hero must render as its own pin at the rezoom zoom: MapLibre clusters
// within ~50px, which at REZOOM_Z is ~1.7 degrees, so the seeded detections
// inside a 2-degree box around the hero soft-delete before the take. Direct
// SQL like sweepResidues; fail-soft without docker.
function clearHeroNeighborhood(hero) {
  if (!hero?.event_coords) return;
  const { lat, lng } = hero.event_coords;
  const sql =
    "UPDATE events e SET deleted_at = now() FROM users u " +
    "WHERE u.id = e.owner_id AND u.username = 'analyst' AND e.deleted_at IS NULL " +
    "  AND e.status = 'detected' " +
    `  AND abs(ST_Y(e.event_coords::geometry) - (${lat})) < 2 ` +
    `  AND abs(ST_X(e.event_coords::geometry) - (${lng})) < 2;`;
  const res = spawnSync(
    "docker",
    ["exec", "vidit-db", "psql", "-U", "vision", "-d", "vision", "-c", sql],
    { encoding: "utf8" }
  );
  if (res.status === 0) {
    console.log(`  hero neighborhood sweep: ${(res.stdout || "").trim()}`);
  } else {
    console.warn(
      `  hero neighborhood sweep skipped (${(res.stderr || "docker unavailable").trim()})`
    );
  }
}

// Idempotent real-data setup: a promoted hero exists, the field is seeded
// with the full analyst export, and only the maintainer's own drafts close
// before the take so the on-camera import re-creates them fresh (closed
// detections are re-importable) while the seeded field stays live.
async function setupRealData(auth) {
  let hero = await findHeroEvent(auth);
  if (!hero) {
    const closed = await closeOpenDetections(auth);
    if (closed) console.log(`  closed ${closed} leftover drafts`);
    await importArchiveViaApi(auth, ensureRealArchive(), "the maintainer archive");
    hero = await promoteHeroDraft(auth);
  } else {
    console.log("→ hero event already promoted");
  }
  await seedBigArchive(auth);
  const heroHandle = handleFromSourceUrl(hero.source_url);
  if (!heroHandle) {
    throw new Error("hero has no source handle; refusing to close the whole seeded field");
  }
  const closed = await closeOpenDetections(auth, heroHandle);
  if (closed) console.log(`  closed ${closed} maintainer drafts (recreated on camera)`);
  sweepResidues(hero.id);
  clearHeroNeighborhood(hero);
  return hero;
}

// ─── the clips ───────────────────────────────────────────────────────────

// Click through pin candidates until the hero's detail panel opens; returns
// the candidate that did, or null. Closes the panel before returning.
async function locateHeroPin(page, hero, expected) {
  const candidates = (await findPinCandidates(page)).sort(
    (a, b) =>
      Math.hypot(a.x - expected.x, a.y - expected.y) -
      Math.hypot(b.x - expected.x, b.y - expected.y)
  );
  if (candidates.length === 0) return null;
  console.log(
    `  expected ${expected.x.toFixed(0)},${expected.y.toFixed(0)}; candidates: ` +
      candidates
        .slice(0, 8)
        .map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)}(${c.area})`)
        .join(" ")
  );
  for (const cand of candidates.slice(0, 14)) {
    await page.mouse.click(cand.x, cand.y);
    const opened = await page
      .waitForSelector('button[aria-label="Close detail panel"]', { timeout: 1500 })
      .catch(() => null);
    if (opened) {
      await wait(900); // detail fetch + media render
      const isHero = await page.evaluate(
        (title) => !!Array.from(document.querySelectorAll("h2")).find((el) =>
          (el.textContent || "").includes(title)
        ),
        hero.title
      );
      await page.click('button[aria-label="Close detail panel"]');
      await wait(600);
      if (isHero) return cand;
    }
  }
  return null;
}

// ─── the single continuous take ──────────────────────────────────────────
//
// The whole in-app demo is ONE recorded take: map (camera eases, pin,
// proofs) → sidemenu Submit → bulk import (Finder pick) → live scan →
// queue → open the promote-ready draft → the human's part on camera
// (conflict + capture source) → review scroll → submit → back to the map,
// Author-filtered to the analyst, one fresh detection opened. One take
// means every beat junction in the comp is a cut
// within the same session and page flow; there is no inter-take seam to
// hide. The comp windows out the dead time (the scan wait) on still frames.

// Camera storyboard for the map beat. The default view is center
// (35.0, 48.5) z5 (Map.tsx initialViewState); the dezoom eases to z3 on the
// same center, the rezoom eases toward a point offset from the hero so the
// pin lands up-right of center inside the open map area, and the drag pan
// then walks it toward center before the click.
const DEZOOM_Z = 3;
const REZOOM_Z = 5.2;
// Closing beat: zoom onto the filtered (author-only) pin field, tight enough
// that the showcase detection separates from its cluster.
const SHOWCASE_Z = 6.2;

// Screen position of `at` when the camera centers `center` at `zoom`
// (approximate under the globe projection; probe ordering only).
function screenFrom(center, at, zoom) {
  const c = mercProject(center.lat, center.lng, zoom);
  const p = mercProject(at.lat, at.lng, zoom);
  return { x: 640 + (p.x - c.x), y: 360 + (p.y - c.y) };
}

// The promote target: newest fully-loaded real detection (media + coords +
// source + posted-at), geographically clear of the hero (a promoted twin at
// the hero's coordinates permanently clusters with it and breaks the pin
// probe on every later re-record), preferring one whose proof already
// carries an image so the on-camera human part stays conflict + capture
// source only.
async function pickPromoteTarget(auth, hero) {
  const awayFromHero = (it) =>
    !hero?.event_coords ||
    !it.event_coords ||
    Math.hypot(
      it.event_coords.lat - hero.event_coords.lat,
      it.event_coords.lng - hero.event_coords.lng
    ) > 3;
  const eligible = (items) =>
    items.filter(
      (it) =>
        it.media?.length > 0 &&
        it.source_url &&
        it.source_posted_at &&
        it.event_coords &&
        awayFromHero(it)
    );

  // Page 1 first, in queue order: a target already on the queue's landing
  // page needs no off-camera pagination hops, which read as a jump cut in
  // the final edit. per_page=20 mirrors the queue's own page size exactly.
  const p1 = await api(auth, "GET", "/events/detections?page=1&per_page=20");
  for (const cand of eligible(p1.items).slice(0, 12)) {
    const detail = await api(auth, "GET", `/events/${cand.id}`);
    if (proofHasImage(detail.proof)) return { id: cand.id, detail, needsProof: false };
  }

  // Fallback: the whole queue, newest field-date first (the hop loop in the
  // take still reaches whatever page it lives on).
  const page1 = await api(auth, "GET", "/events/detections?page=1&per_page=50");
  const items = [...page1.items];
  if (page1.total > 50) {
    const page2 = await api(auth, "GET", "/events/detections?page=2&per_page=50");
    items.push(...page2.items);
  }
  const byDateDesc = eligible(items).sort((a, b) =>
    (b.event_date || "").localeCompare(a.event_date || "")
  );
  if (byDateDesc.length === 0) {
    throw new Error("no promote-ready draft (run after a fresh archive import)");
  }
  for (const cand of byDateDesc.slice(0, 12)) {
    const detail = await api(auth, "GET", `/events/${cand.id}`);
    if (proofHasImage(detail.proof)) return { id: cand.id, detail, needsProof: false };
  }
  const detail = await api(auth, "GET", `/events/${byDateDesc[0].id}`);
  return { id: byDateDesc[0].id, detail, needsProof: true };
}

// The closing beat's showcase: a real machine detection with media + coords,
// the most isolated of the batch so its pin renders unclustered (clusters
// paint in the base colour, so the detected-colour probe would miss it) and
// a first click lands. Excludes the just-promoted target (now base-coloured).
async function pickShowcaseDetected(auth, excludeId) {
  const page1 = await api(auth, "GET", "/events/detections?page=1&per_page=50");
  const items = [...page1.items];
  if (page1.total > 50) {
    const page2 = await api(auth, "GET", "/events/detections?page=2&per_page=50");
    items.push(...page2.items);
  }
  const placed = items.filter((it) => it.event_coords);
  // Stay inside the Iran box, where the seeded work masses: an outlier
  // showcase (a lone Russia point) drags the closing camera away from the
  // field and the zoom reads as arbitrary.
  const inIranBox = (it) =>
    it.event_coords.lat > 24 &&
    it.event_coords.lat < 40 &&
    it.event_coords.lng > 44 &&
    it.event_coords.lng < 64;
  const base = placed.filter((it) => it.id !== excludeId && it.media?.length > 0);
  const eligible = base.filter(inIranBox).length > 0 ? base.filter(inIranBox) : base;
  if (eligible.length === 0) throw new Error("no showcase detection available");
  const isolation = (it) =>
    Math.min(
      99,
      ...placed
        .filter((o) => o.id !== it.id)
        .map((o) =>
          Math.hypot(
            o.event_coords.lat - it.event_coords.lat,
            o.event_coords.lng - it.event_coords.lng
          )
        )
    );
  return eligible.sort((a, b) => isolation(b) - isolation(a))[0];
}

async function clipDemo(auth, hero, zipPath) {
  if (!hero || !hero.event_coords) throw new Error("hero event not available");
  const heroLL = { lng: hero.event_coords.lng, lat: hero.event_coords.lat };
  // The rezoom parks the hero up-right of center, clear of the sidebar and
  // of the bottom-left map controls.
  const rezoomCenter = { lng: heroLL.lng + 1.7, lat: heroLL.lat - 1.15 };

  await recordClip("demo", { cookies: auth.cookies }, async (page, rec) => {
    const openMap = async () => {
      await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".maplibregl-canvas", { timeout: 15000 });
      await page.waitForFunction(() => {
        const c = document.querySelector(".maplibregl-canvas");
        return c && c.clientWidth > 0 && !!window.__viditMap;
      }, { timeout: 15000 });
      await wait(3500); // tiles + pins settle
      await page.getByRole("button").filter({ hasText: /^Filters/ }).first().click();
      await wait(900);
    };

    // ── probe pass (silent): replay the exact camera moves fast, locate the
    // hero pin at each end state. easeTo end states are exact, so the
    // recorded pass lands on identical geometry.
    console.log("→ /map probe pass: camera moves + pin location");
    await openMap();
    // No pin probe at the dezoom state: with the seeded field the hero sits
    // inside a z3 cluster by design; the click happens at the rezoom state,
    // where clearHeroNeighborhood guarantees it renders unclustered. The
    // ease itself still replays so the camera path matches the recording.
    await easeCamera(page, { zoom: DEZOOM_Z, durationMs: 900 });
    await easeCamera(page, { center: [rezoomCenter.lng, rezoomCenter.lat], zoom: REZOOM_Z, durationMs: 900 });
    const t2a = await locateHeroPin(page, hero, screenFrom(rezoomCenter, heroLL, REZOOM_Z));
    if (!t2a) throw new Error("hero pin not found at the rezoom state");
    const delta = panDeltaFor(t2a);
    const panFrom = { x: 700, y: 470 };
    await dragPan(page, panFrom, delta);
    await wait(1200);
    const t2 = await locateHeroPin(page, hero, { x: t2a.x + delta.dx, y: t2a.y + delta.dy });
    if (!t2) throw new Error("hero pin not found after the pan");
    console.log(`  hero pin after pan: ${t2.x.toFixed(0)},${t2.y.toFixed(0)}`);
    // A neighbour pin for the warm-up hover (the preview card showcase).
    // Two guards, both earned the hard way: an area BAND, because a cluster
    // ring minus its white count text can sneak under a plain area cap and
    // clusters have no preview; then a live hover check in this silent
    // pass, because only the preview card actually mounting proves the
    // candidate is an individual pin.
    // Real pins measure anywhere from ~70 to ~550 px2 at DPR 2 depending
    // on the basemap under them; the floor only screens noise specks, the
    // hover verification below is what actually proves pin-ness.
    const PIN_AREA_MIN = 15 * CAPTURE_DPR * CAPTURE_DPR;
    const PIN_AREA_MAX = 180 * CAPTURE_DPR * CAPTURE_DPR;
    // Neighbour by DATA, not pixels: pick detections that carry media and
    // project their coordinates through the live camera (map.project is
    // exact at an easeTo end state), then verify the nearest few by an
    // actual hover: the preview card must mount without the "no media"
    // placeholder. Pixel scans kept picking the rare media-less pins.
    const dets = await api(auth, "GET", "/events/detections?page=1&per_page=50");
    const located = await api(auth, "GET", "/events?per_page=50");
    const pool = [
      ...dets.items,
      ...(Array.isArray(located) ? located : located.items || []),
    ];
    const projected = [];
    const seenKeys = new Set();
    for (const it of pool) {
      if (!it.event_coords || !it.media) continue;
      const mediaArr = Array.isArray(it.media) ? it.media : [it.media];
      if (mediaArr.filter(Boolean).length === 0) continue;
      const key = `${it.event_coords.lat},${it.event_coords.lng}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const pt = await page.evaluate(
        ({ lng, lat }) => window.__viditMap.project([lng, lat]),
        { lng: it.event_coords.lng, lat: it.event_coords.lat }
      );
      const d = Math.hypot(pt.x - t2.x, pt.y - t2.y);
      if (pt.x > 180 && pt.x < 1100 && pt.y > 100 && pt.y < 680 && d > 60) {
        projected.push({ x: pt.x, y: pt.y, d });
      }
    }
    projected.sort((a, b) => a.d - b.d);
    let neighbour = null;
    let fallback = null;
    for (const cand of projected.slice(0, 14)) {
      await page.mouse.move(cand.x, cand.y, { steps: 12 });
      await wait(900); // hover intent + detail fetch + media mount
      const probe = await page.evaluate(() => {
        const card = document.querySelector('div[class*="z-[1100]"][class*="w-64"]');
        const noMedia = !!card && /no media/i.test(card.textContent || "");
        return { card: !!card, media: !!card && !noMedia };
      });
      console.log(
        `  probe hover ${cand.x.toFixed(0)},${cand.y.toFixed(0)} card=${probe.card} media=${probe.media}`
      );
      await page.mouse.move(640, 200, { steps: 8 });
      await wait(300);
      if (probe.card && probe.media) {
        neighbour = cand;
        break;
      }
      if (probe.card && !fallback) fallback = cand;
    }
    if (!neighbour && fallback) neighbour = fallback;
    console.log(
      neighbour
        ? `  hover neighbour (preview verified): ${neighbour.x.toFixed(0)},${neighbour.y.toFixed(0)}`
        : "  no hover neighbour verified (skipping the warm-up hover)"
    );

    // ── recorded pass ────────────────────────────────────────────────────
    console.log("→ reload, recorded pass");
    await openMap();
    await page.mouse.move(640, 330);
    await rec.start();
    await wait(1200); // cold open on the pin field

    console.log("→ camera dezoom (continuous ease)");
    rec.mark("dezoom");
    await easeCamera(page, { zoom: DEZOOM_Z, durationMs: 2000 });
    await wait(900); // clusters breathe

    console.log("→ camera back in toward the hero");
    rec.mark("rezoom");
    await easeCamera(page, { center: [rezoomCenter.lng, rezoomCenter.lat], zoom: REZOOM_Z, durationMs: 1900 });
    await wait(600);

    console.log("→ drag pan");
    rec.mark("pan");
    await dragPan(page, panFrom, delta);
    await wait(800);

    // Warm-up hover: the pointer visits a neighbour pin first and its
    // preview card pops (the hover affordance shipped with the stack work),
    // then travels to the hero, whose preview breathes before the click.
    console.log("→ hover a neighbour pin, then the hero (previews on camera)");
    rec.mark("pinHover");
    if (neighbour) {
      await page.mouse.move(neighbour.x, neighbour.y, { steps: 50 });
      await wait(1400); // intent delay + fetch + the card reads
    }
    rec.mark("pinApproach");
    await page.mouse.move(t2.x, t2.y, { steps: 55 });
    await wait(1200); // the hero's preview card breathes before the click
    await page.mouse.click(t2.x, t2.y);
    let panel = await page
      .waitForSelector('button[aria-label="Close detail panel"]', { timeout: 4000 })
      .catch(() => null);
    if (!panel) {
      // Sub-pixel drift between passes: re-locate once; on camera it reads
      // as a second, corrected click.
      const rescue = await locateHeroPin(page, hero, t2);
      if (!rescue) throw new Error("hero pin lost in the recorded pass");
      await page.mouse.move(rescue.x, rescue.y, { steps: 40 });
      await wait(400);
      await page.mouse.click(rescue.x, rescue.y);
      panel = await page.waitForSelector('button[aria-label="Close detail panel"]', {
        timeout: 4000,
      });
    }
    rec.mark("panelOpen");
    await wait(1600); // panel top: title, real media, byline

    console.log("→ scroll the detail panel (proofs)");
    rec.mark("panelScroll");
    await slowScrollPanel(page, 2200);
    await wait(900);

    // ── sidemenu → /submit, same session, same take ──────────────────────
    console.log("→ sidemenu: Submit");
    rec.mark("navSubmit");
    await glideAndClick(page, page.locator('aside a[href="/submit"]').first(), {
      steps: 45,
    });
    const bulkBtn = page.getByRole("button", { name: /bulk import/i }).first();
    await bulkBtn.waitFor({ timeout: 15000 });
    await wait(1400);

    console.log("→ switch to Bulk import");
    rec.mark("modeClick");
    await glideAndClick(page, bulkBtn);
    await wait(1700); // the export guide renders, give it a read

    console.log("→ scroll to the drop zone (eased, on camera)");
    const chooseBtn = page.getByText("Choose your X archive", { exact: false }).first();
    rec.mark("scrollGuide");
    await slowScrollToLocator(page, chooseBtn, 1500);
    await wait(650);

    console.log("→ open the mock Finder dialog");
    page.on("filechooser", () => {}); // headless: swallow the real chooser
    rec.mark("finderOpen");
    await glideAndClick(page, chooseBtn, { steps: 48, settle: 400 });
    await injectFinder(page, path.basename(REAL_ARCHIVE_SOURCE), fs.statSync(zipPath).size);
    await wait(1100);

    console.log("→ pick the zip in the Finder");
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
      name: path.basename(REAL_ARCHIVE_SOURCE),
      mimeType: "application/zip",
      buffer: fs.readFileSync(zipPath),
    });
    rec.mark("filePicked");
    await wait(1500); // the file card ("ready to import") breathes

    console.log("→ click Import archive, scroll to the live stepper");
    const importBtn = page.getByRole("button", { name: /^import archive$/i }).first();
    await glideAndClick(page, importBtn);
    rec.mark("importClick");
    // The stepper mounts below the fold; bring it into view right after the
    // submit (on camera), so the extraction counter and the Done state both
    // play out without any later scroll.
    await wait(400);
    await slowScrollToLocator(
      page,
      page.getByText("Filtering out private data").first(),
      1000,
      260
    ).catch(() => {});

    console.log("→ live extraction progress (the stepper)");
    await page
      .waitForSelector("text=/Reading your posts|geolocations extracted/", { timeout: 120000 })
      .then(() => rec.mark("scanVisible"))
      .catch(() => console.warn("  (extraction progress never showed)"));

    // The stepper finishes IN PLACE (no auto-redirect since the PR #156
    // rework): wait for the completion CTA, then click it on camera.
    console.log("→ wait for Done, click Review your detections");
    const reviewCta = page.getByRole("link", { name: /review your detections/i }).first();
    await reviewCta.waitFor({ timeout: 600000 });
    await wait(1500); // the completed stepper reads before the move
    const ctaBox = await reviewCta.boundingBox();
    if (!ctaBox || ctaBox.y < 0 || ctaBox.y + ctaBox.height > 700) {
      await smoothScrollIntoView(page, reviewCta, 900);
    }
    await glideAndClick(page, reviewCta, { steps: 48 });
    await page.waitForURL(/\/profile\/[^/]+\/detections/, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    rec.mark("queueRedirect");
    await page.waitForSelector('a[href^="/events/"][href$="/edit"]', { timeout: 15000 });
    await wait(1800); // the filled queue breathes

    // ── promote target picked mid-take, off camera (API only) ────────────
    const target = await pickPromoteTarget(auth, hero);
    console.log(`→ promote target: ${target.detail.title} (${target.id})`);
    const card = page.locator(`a[href="/events/${target.id}/edit"]`).first();
    // The queue paginates (20 per page) and the target rides whatever page
    // its import position landed on. Hop pages until its card mounts; the
    // hops sit between the comp's windows, so the final cut jumps from the
    // queue landing straight to the target's page (same layout, a plain
    // in-queue jump cut).
    const nextBtn = page.getByRole("button", { name: /^next$/i }).first();
    for (let hop = 0; hop < 10; hop++) {
      if ((await card.count()) > 0) break;
      if (!(await nextBtn.isEnabled().catch(() => false))) break;
      console.log("  → queue page hop");
      await nextBtn.click();
      await wait(900);
    }
    await card.waitFor({ timeout: 10000 });
    await wait(1200); // the target's page settles before the cut window

    // The freshly hopped page still loads its media thumbnails, which
    // shifts the list under the cursor mid-glide; wait until the card's
    // geometry holds still before approaching it.
    let prevBox = null;
    for (let i = 0; i < 16; i++) {
      const box = await card.boundingBox();
      if (box && prevBox && Math.abs(box.y - prevBox.y) < 1 && Math.abs(box.height - prevBox.height) < 1) break;
      prevBox = box;
      await wait(400);
    }

    console.log("→ open the target draft");
    rec.mark("draftApproach");
    await smoothScrollIntoView(page, card, 1300);
    await wait(450);
    await glideClickStretchedCard(page, card, target.id);
    await page.waitForURL(new RegExp(`/events/${target.id}/edit`), { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Submit detection", { timeout: 25000 });
    await page.waitForSelector('input[aria-label="Search conflicts"]', { timeout: 15000 });
    rec.mark("draftOpen");
    await wait(1800); // the draft's top: title + real media

    // ── the human's part, ON CAMERA: conflict + capture source ───────────
    console.log("→ fill the conflict (on camera)");
    const conflictInput = page.locator('input[aria-label="Search conflicts"]').first();
    rec.mark("conflictFocus");
    await slowScrollToLocator(page, conflictInput, 1300, 250);
    await wait(380);
    await glideAndClick(page, conflictInput, { steps: 42, settle: 380 });
    const wantGaza = (target.detail.event_coords?.lng ?? 99) < 40;
    await page.keyboard.type(wantGaza ? "Gaza" : "Iran", { delay: 70 });
    await wait(550);
    const suggestion = page
      .getByRole("button", { name: wantGaza ? /gaza/i : /iran/i })
      .first();
    rec.mark("conflictPick");
    await glideAndClick(page, suggestion, { steps: 30, settle: 350 });
    await wait(600);

    console.log("→ pick the capture source (on camera)");
    const captureChip = page.getByRole("button", { name: /^Static camera$/ }).first();
    await slowScrollToLocator(page, captureChip, 1000, 320).catch(() => {});
    await wait(300);
    rec.mark("capturePick");
    await glideAndClick(page, captureChip, { steps: 38, settle: 380 });
    await wait(650);

    if (target.needsProof) {
      // Fallback human part: the draft came without a proof image; add the
      // satellite proof through the real "+ Image" input. The comp's fill
      // window ends at capturePick, so this lands off the final cut while
      // the proof image itself shows during the review scroll.
      console.log("→ add the proof image (fallback)");
      ensureMediaCache();
      const proofInput = page.locator('label:has-text("+ Image") input[type="file"]').first();
      await proofInput.setInputFiles(PROOF_IMG);
      await wait(1200);
    }

    console.log("→ review scroll to the bottom (eased)");
    rec.mark("reviewScroll");
    await slowScrollToY(
      page,
      await page.evaluate(() => document.documentElement.scrollHeight),
      3200
    );
    await wait(900);

    console.log("→ Submit → Confirm & submit");
    const submitBtn = page.getByRole("button", { name: /^submit$/i }).first();
    rec.mark("submit");
    await glideAndClick(page, submitBtn);
    await wait(500);
    const confirmBtn = page.getByRole("button", { name: /confirm & submit/i }).first();
    await confirmBtn.waitFor({ timeout: 5000 });
    await wait(450); // the confirm step reads before the click
    await glideAndClick(page, confirmBtn, { steps: 38, settle: 600 });
    await page.waitForURL(/\/profile\/[^/]+\/detections/, { timeout: 30000 });
    rec.mark("published");
    await wait(1700); // the row is gone from the queue

    // ── the analyst's work, in one place, back ON the map ────────────────
    // Field feedback drove this closing beat: what lands with analysts is
    // seeing scattered work materialized in one place. So the take returns
    // to the map, filters on the analyst's own handle (the real Author
    // filter), and opens one of the fresh machine detections.
    console.log("→ sidemenu: Map, filter on the analyst, open a detection");
    const showcase = await pickShowcaseDetected(auth, target.id);
    console.log(`  showcase detection: ${showcase.title} (${showcase.id})`);
    rec.mark("mapReturn");
    await glideAndClick(page, page.locator('aside a[href="/map"]').first(), { steps: 48 });
    await page.waitForURL(/\/map/, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 20000 });
    await page.waitForFunction(() => {
      const c = document.querySelector(".maplibregl-canvas");
      return c && c.clientWidth > 0 && !!window.__viditMap;
    }, { timeout: 15000 });
    // The map restores the last selected event (the hero, opened at the top
    // of the take) in the side panel; dismiss it the instant the page lands,
    // off camera (the comp cuts away before the landing), so no window ever
    // catches it open.
    const staleClose = await page
      .waitForSelector('button[aria-label="Close detail panel"]', { timeout: 2500 })
      .catch(() => null);
    if (staleClose) {
      await staleClose.click();
      await wait(300);
    }
    await wait(2000); // tiles + the full pin field settle

    // The filter panel keeps its open state across navigation
    // (MapStateContext); reopen it on camera only if it came back closed.
    const authorToggle = page.locator('button[aria-label="Toggle Author"]').first();
    if (!(await authorToggle.isVisible().catch(() => false))) {
      await glideAndClick(
        page,
        page.getByRole("button").filter({ hasText: /^Filters/ }).first(),
        { steps: 45 }
      );
      await wait(600);
    }
    rec.mark("authorOpen");
    await glideAndClick(page, authorToggle, { steps: 45 });
    await wait(550);

    console.log("→ type the analyst's handle");
    const authorInput = page.locator('input[aria-label="Author username"]').first();
    rec.mark("authorType");
    await glideAndClick(page, authorInput, { steps: 40, settle: 350 });
    await page.keyboard.type("analyst", { delay: 70 });
    await wait(850); // typeahead debounce + fetch
    const authorPill = page.getByRole("button", { name: "@analyst" }).first();
    await authorPill.waitFor({ timeout: 5000 });
    rec.mark("authorPick");
    await glideAndClick(page, authorPill, { steps: 35, settle: 350 });
    await wait(1900); // the map refetches: only the analyst's work remains

    console.log("→ collapse the filter panel (on camera), clear the view");
    rec.mark("filtersClose");
    await glideAndClick(
      page,
      page.getByRole("button").filter({ hasText: /^Filters/ }).first(),
      { steps: 42 }
    );
    await wait(600);

    console.log("→ ease onto the analyst's work, open a detected pin");
    const showLL = { lng: showcase.event_coords.lng, lat: showcase.event_coords.lat };
    const showCenter = { lng: showLL.lng + 1.0, lat: showLL.lat - 0.6 };
    rec.mark("workEase");
    await easeCamera(page, {
      center: [showCenter.lng, showCenter.lat],
      zoom: SHOWCASE_Z,
      durationMs: 2000,
    });
    await wait(600);
    const expected = screenFrom(showCenter, showLL, SHOWCASE_Z);
    const detCands = (await findPinCandidates(page, "detected")).sort(
      (a, b) =>
        Math.hypot(a.x - expected.x, a.y - expected.y) -
        Math.hypot(b.x - expected.x, b.y - expected.y)
    );
    if (detCands.length === 0) throw new Error("no detected pin on the filtered map");
    console.log(
      `  expected ${expected.x.toFixed(0)},${expected.y.toFixed(0)}; detected candidates: ` +
        detCands.slice(0, 6).map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(" ")
    );
    rec.mark("detectedApproach");
    let openedDetected = null;
    for (const cand of detCands.slice(0, 3)) {
      await page.mouse.move(cand.x, cand.y, { steps: 55 });
      await wait(480);
      await page.mouse.click(cand.x, cand.y);
      openedDetected = await page
        .waitForSelector('button[aria-label="Close detail panel"]', { timeout: 2500 })
        .catch(() => null);
      if (openedDetected) break;
    }
    if (!openedDetected) throw new Error("no detected pin opened a panel");
    rec.mark("detectedOpen");
    await wait(3400); // the draft's panel: real media, the analyst's byline
  });
}

// The bot beat's base layer: the OFFICIAL X embed (dark theme) of the
// analyst's real coordinate tweet, rendered by platform.twitter.com in a
// real browser and recorded as a static plate. The Remotion comp animates
// the tag reply + like + bot reply as an overlay below it, and the whole
// beat is replaced verbatim by public/clips/bot-x-capture.mp4 once the
// real end-to-end exchange exists on X.
async function clipBotEmbed() {
  await recordClip("bot-embed", { cookies: null }, async (page, rec) => {
    console.log("→ render the official X embed (dark)");
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
         html,body { margin:0; background:#000; height:100%; overflow:hidden; }
         /* The real tweet (with its quoted tweet) renders ~970px tall at
            width 440; scale it to fit the 720px viewport with the reply
            column composed to its right by the Remotion overlay. */
         #holder { position:absolute; left:84px; top:10px; width:440px;
                   transform: scale(0.72); transform-origin: top left; }
         .twitter-tweet { margin: 0 !important; }
       </style></head><body>
         <div id="holder">
           <blockquote class="twitter-tweet" data-theme="dark" data-dnt="true" data-width="440" data-conversation="none">
             <a href="${BOT_EMBED_TWEET}"></a>
           </blockquote>
         </div>
         <script async src="https://platform.twitter.com/widgets.js"></script>
       </body></html>`,
      { waitUntil: "domcontentloaded" }
    );
    // The widget replaces the blockquote with an iframe once rendered.
    await page.waitForSelector('iframe[id^="twitter-widget"]', { timeout: 45000 });
    await page.waitForFunction(
      () => {
        const f = document.querySelector('iframe[id^="twitter-widget"]');
        return f && f.getBoundingClientRect().height > 220;
      },
      { timeout: 45000 }
    );
    await wait(2500); // media inside the embed finishes loading
    const box = await page.evaluate(() => {
      const f = document.querySelector('iframe[id^="twitter-widget"]');
      const r = f.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    console.log(`  embed box: ${JSON.stringify(box)}`);
    rec.start();
    // Static plate: the overlay animation happens in the comp.
    await wait(9000);
    // Stash the embed geometry (CSS px in the 1280×720 page) as marks so
    // the comp can place the reply overlay right under the real embed.
    rec.set("embedX", box.x);
    rec.set("embedY", box.y);
    rec.set("embedW", box.w);
    rec.set("embedH", box.h);
  });
}

// ─── main ────────────────────────────────────────────────────────────────

(async () => {
  const which = (process.argv[2] || "demo,bot-embed").split(",");

  const auth = await mintCookies("analyst@vidit.app", "analyst");
  const zipPath = ensureRealArchive();

  // Real-data setup: promoted hero + empty open queue (see setupRealData).
  // The queue-clearing half only matters when a take that needs a clean
  // field (map) or that re-imports (import) is being recorded; a partial
  // run of queue/promote alone must keep the existing drafts.
  const needsCleanField = which.includes("demo");
  const hero = needsCleanField
    ? await setupRealData(auth)
    : (await findHeroEvent(auth)) ?? (await setupRealData(auth));

  if (which.includes("demo")) await clipDemo(auth, hero, zipPath);
  if (which.includes("bot-embed")) await clipBotEmbed();

  console.log("\n✓ all requested clips recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
