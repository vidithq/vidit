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
// The capture technique (polling screenshot grabber at 60fps, DOM cursor
// overlay, measured-fps encode) and the motion vocabulary live in
// capture-lib.js, shared with record-v05.js. This file owns the storyboard:
// the pages, the clicks, the data setup and the marks.
//
// Usage: node record-v04.js [demo,bot-embed]  (default: both)

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ensureMediaCache, PROOF_IMG } = require("./gen-archive");

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const FPS = 60;
// The recording context's deviceScaleFactor. The orange-pin pixel scan
// decodes device px and maps candidates back to CSS px through it, so the
// two must stay the same number.
const CAPTURE_DPR = 2;
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
// 0.3 pipeline used; see record-submit.js TWEET_URL). PROMO_BOT_TWEET swaps
// it for a shoot: X renders whichever public status it is given, and which one
// reads best is a question for the frames rather than for this constant.
const BOT_EMBED_TWEET =
  process.env.PROMO_BOT_TWEET || "https://x.com/geo27752/status/2060086984513626223";

const {
  wait,
  mintCookies: mintCookiesRaw,
  apiCall,
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
} = require("./capture-lib");

// The shared API helpers, bound to this pipeline's backend.
const mintCookies = (email, password) => mintCookiesRaw(API, email, password);
const api = (auth, method, pathname, body) => apiCall(API, auth, method, pathname, body);

// The shared clip recorder, bound to this pipeline's output paths.
const recordClip = createRecorder({
  clipsDir: CLIPS_DIR,
  metaPath: META_PATH,
  outDir: path.join(__dirname, "out"),
  fps: FPS,
  dpr: CAPTURE_DPR,
});

// Pan the hero pin toward the open-map center, always visibly.
function panDeltaFor(pin) {
  const dx = Math.max(-130, Math.min(130, 600 - pin.x));
  const dy = Math.max(-95, Math.min(95, 340 - pin.y));
  return {
    dx: Math.abs(dx) < 55 ? (dx < 0 ? -55 : 55) : Math.round(dx),
    dy: Math.abs(dy) < 40 ? (dy < 0 ? -40 : 40) : Math.round(dy),
  };
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
// The map beat opens a REAL geolocation: one detection from the maintainer's
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

// Close open detections. With `onlyHandle`, only detections whose source tweet
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

// Promote one rich real detection (media + coordinate + source) to `geolocated`
// through the same endpoint the edit form uses, filling the human's part
// (conflict, capture source, a proof image when the detection has none).
async function promoteHeroDetection(auth) {
  const list = await api(auth, "GET", "/events/detections?page=1&per_page=50");
  const ranked = list.items
    .filter((it) => it.event_coords && it.media && it.media.length > 0)
    .sort((a, b) => (b.media?.length ?? 0) - (a.media?.length ?? 0));
  const detection = ranked[0];
  if (!detection) throw new Error("no promotable detection found in the real archive import");
  const detail = await api(auth, "GET", `/events/${detection.id}`);
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
  const res = await fetch(`${API}/events/${detection.id}/geolocate`, {
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
// re-imported detections and publishes one event, so closed/geolocated copies
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
// with the full analyst export, and only the maintainer's own detections close
// before the take so the on-camera import re-creates them fresh (closed
// detections are re-importable) while the seeded field stays live.
async function setupRealData(auth) {
  let hero = await findHeroEvent(auth);
  if (!hero) {
    const closed = await closeOpenDetections(auth);
    if (closed) console.log(`  closed ${closed} leftover detections`);
    await importArchiveViaApi(auth, ensureRealArchive(), "the maintainer archive");
    hero = await promoteHeroDetection(auth);
  } else {
    console.log("→ hero event already promoted");
  }
  await seedBigArchive(auth);
  const heroHandle = handleFromSourceUrl(hero.source_url);
  if (!heroHandle) {
    throw new Error("hero has no source handle; refusing to close the whole seeded field");
  }
  const closed = await closeOpenDetections(auth, heroHandle);
  if (closed) console.log(`  closed ${closed} maintainer detections (recreated on camera)`);
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
// queue → open the promote-ready detection → the human's part on camera
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
  // the final edit. per_page=10 mirrors the queue's own page size exactly
  // (`DETECTIONS_PER_PAGE` in frontend/src/lib/events.ts).
  const p1 = await api(auth, "GET", "/events/detections?page=1&per_page=10");
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
    throw new Error("no promote-ready detection (run after a fresh archive import)");
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
    // Every queue row links its detection inside a review pass, so the href
    // carries the `?queue=1` flag the edit page reads.
    await page.waitForSelector('a[href^="/events/"][href$="/edit?queue=1"]', {
      timeout: 15000,
    });
    await wait(1800); // the filled queue breathes

    // ── promote target picked mid-take, off camera (API only) ────────────
    const target = await pickPromoteTarget(auth, hero);
    console.log(`→ promote target: ${target.detail.title} (${target.id})`);
    const card = page.locator(`a[href="/events/${target.id}/edit?queue=1"]`).first();
    // The queue paginates (10 per page) and the target rides whatever page
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

    console.log("→ open the target detection");
    rec.mark("detectionApproach");
    await smoothScrollIntoView(page, card, 1300);
    await wait(450);
    await glideClickStretchedCard(page, card, target.id);
    await page.waitForURL(new RegExp(`/events/${target.id}/edit`), { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Submit detection", { timeout: 25000 });
    await page.waitForSelector('input[aria-label="Search conflicts"]', { timeout: 15000 });
    rec.mark("detectionOpen");
    await wait(1800); // the detection's top: title + real media

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
      // Fallback human part: the detection came without a proof image; add the
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

    console.log("→ Submit (arm, then confirm)");
    // Located by type rather than by name: the button arms in place and its
    // label walks Submit -> Confirm submit -> Submitting… across the two
    // clicks. The second click has to land inside ARM_MS (3s), so the settle
    // stays short.
    const submitBtn = page.locator('form button[type="submit"]').first();
    rec.mark("submit");
    await glideAndClick(page, submitBtn);
    await page
      .getByRole("button", { name: /confirm submit/i })
      .first()
      .waitFor({ timeout: 5000 });
    await wait(450); // the armed ring reads before the confirming click
    await glideAndClick(page, submitBtn, { steps: 10, settle: 260 });
    // Where a submit lands depends on whether the row the queue linked is
    // inside the batch a review pass walks: inside it the form hands over to
    // the next detection's own URL, outside it the pass is over and the queue
    // list comes back. Either way the target's edit page is left behind.
    await page.waitForURL((url) => !url.href.includes(`${target.id}/edit`), {
      timeout: 30000,
    });
    rec.mark("published");
    await wait(1700); // the page the submit handed over to settles

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
    await wait(3400); // the detection's panel: real media, the analyst's byline
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
            width 440; scale it to fit the 720px viewport. Centred, because
            the plate is the whole picture now: BotBeat plays it inside the
            browser chrome on its own, where an off-centre column would leave
            two thirds of the frame black. 482 = (1280 - 440 x 0.72) / 2. */
         #holder { position:absolute; left:482px; top:10px; width:440px;
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
  const which = (process.argv[2] || "demo,bot-embed").split(",").map((w) => w.trim());

  // The bot-embed plate is an X embed and nothing else: no session, no
  // archive, no instance. A run that asks for the plate alone therefore signs
  // in to nothing and leaves the queue exactly as it found it, which is what
  // lets the other pipelines borrow the plate without their own field being
  // rearranged under them.
  if (which.some((w) => w !== "bot-embed")) {
    const auth = await mintCookies("analyst@vidit.app", "analyst");
    const zipPath = ensureRealArchive();

    // Real-data setup: promoted hero + empty open queue (see setupRealData).
    // The queue-clearing half only matters when a take that needs a clean
    // field (map) or that re-imports (import) is being recorded; a partial
    // run of queue/promote alone must keep the existing detections.
    const needsCleanField = which.includes("demo");
    const hero = needsCleanField
      ? await setupRealData(auth)
      : (await findHeroEvent(auth)) ?? (await setupRealData(auth));

    if (which.includes("demo")) await clipDemo(auth, hero, zipPath);
  }
  if (which.includes("bot-embed")) await clipBotEmbed();

  console.log("\n✓ all requested clips recorded");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
