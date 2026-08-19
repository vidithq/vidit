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
// Glide the cursor onto an element and stop there. The same motion as
// `glideAndClick` without the press, for a beat that FRAMES a control rather
// than using it: the hover state paints, the cursor names what the caption is
// talking about, and nothing is activated. A native `title` tooltip is browser
// UI rather than page content, so it is not part of what the capture grabs.
async function glideHover(page, locator, { steps = 50, hold = 1200 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  await wait(hold);
  return { x, y };
}

async function glideAndClick(page, locator, { steps = 50, settle = 450 } = {}) {
  const { x, y } = await glideHover(page, locator, { steps, hold: settle });
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

// ─── the mock macOS open dialog for the import beats ─────────────────────
//
// Headless Chromium can't show the real file chooser, so the recorded pick
// is a Finder-style open dialog injected into the page: dark vibrancy, the
// traffic lights, a Favourites sidebar, a Downloads list with the real
// archive in it. The cursor glides to the zip, double-clicks, the dialog
// closes, and the real input is fed off camera right after.
//
// Both import takes (record-v04.js, record-v05b.js) open this dialog, so the
// caller passes the name and the byte size of the zip it actually feeds the
// input: what the row reads is what gets imported.
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

// Build the clip recorder a script uses. `clipsDir` is where the mp4 lands
// (Remotion's staticFile root) and `metaPath` the timing sidecar
// gen-clips-manifest.js compiles into src/clips-manifest.ts.
//
// `viewport` is the page size in CSS px. Whatever you pass, the comp's browser
// body has to carry the same aspect ratio, or `objectFit: cover` crops the
// recording. 1280x720 is the 16:9 laptop the v0.4 take films; a taller window
// fits more of a long page above the fold.
function createRecorder({
  clipsDir,
  metaPath,
  outDir,
  fps = 60,
  dpr = 2,
  viewport = { width: 1280, height: 720 },
}) {
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
    const launchOptions = {
      headless: true,
      // --force-device-scale-factor: the raw CDP captureScreenshot grabs the
      // SURFACE, which ignores Playwright's emulated deviceScaleFactor (only
      // Playwright's own screenshot path re-renders at the override). Without
      // this flag every take captured at 720p and the encode upscaled it.
      args: ["--use-angle=metal", `--force-device-scale-factor=${dpr}`],
    };
    // Playwright's bundled Chromium ships without the H.264 decoder, so every
    // source video on camera stays a black box and its poster frame never
    // paints. The installed Google Chrome decodes it; fall back to the bundle
    // only where Chrome is absent, and say so, since that take will show the
    // black player.
    let browser;
    try {
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
    } catch {
      console.log("  (Google Chrome not found; bundled Chromium has no H.264, videos will render black)");
      browser = await chromium.launch(launchOptions);
    }
    const ctx = await browser.newContext({
      viewport,
      // DPR 2 doubles the captured device px: the comp shows the recording
      // smaller than it was captured, so the downscale headroom is what makes
      // it read sharp. Costs capture fps (VFR encoding absorbs it).
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
          // Encode at the captured device resolution, rounded to even
          // dimensions for yuv420p. Rescaling to a fixed 16:9 here is what
          // squashed a non-16:9 viewport.
          "-vf",
          `fps=60,scale=${Math.round((viewport.width * dpr) / 2) * 2}:${
            Math.round((viewport.height * dpr) / 2) * 2
          }:flags=lanczos`,
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
  glideHover,
  glideAndClick,
  slowScrollToY,
  slowScrollToLocator,
  slowScrollPanel,
  easeCamera,
  dragPan,
  smoothScrollIntoView,
  glideClickStretchedCard,
  injectFinder,
  closeFinder,
  createRecorder,
};
