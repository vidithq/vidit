// The annotated screenshots of the guides (`/guide`, `/import`).
//
// `frontend/src/app/_shots/shots.json` groups the shots by page. Each shot names
// a route, a window, and the elements it numbers. The page renders that same list
// as the legend under the image, so a marker and its legend line cannot drift:
// edit the JSON, re-run this script, and both change together.
//
// For each shot the script opens the route in Chrome, runs the shot's `prepare`
// step below, draws an orange disc with a white number centred on each target
// (`place` picks the side of the target's box), and writes a WebP to
// `frontend/public/<page>/`. It fails if a target is missing, so a renamed
// control surfaces here rather than as a wrong number on the page.
//
// Two rules, both editorial:
//
//   1. No content is written. The script signs in, opens menus and drawers,
//      scrolls and reads pages; it never submits a form.
//   2. No private data. A shot with `"session": "signed-in"` signs in as
//      GUIDE_LOGIN_EMAIL / GUIDE_LOGIN_PASSWORD, and every shot fails if an
//      email address shows inside its frame.
//
// Usage: node shoot-guide.js       (the instance must already be running)
//   GUIDE_BASE   the frontend, default http://localhost:3000
//   GUIDE_API    the API, default http://localhost:8000/api/v1 (sign-in only)
//   GUIDE_EVENT  the published geolocation the `event` shot reads
//   GUIDE_APPROVE_EVENT  another analyst's geolocation the `approvals` shot reads
//   GUIDE_LOGIN_EMAIL, GUIDE_LOGIN_PASSWORD  the account the signed-in shots use
//   GUIDE_ONLY   a comma-separated list of shot ids to re-shoot

const fs = require("fs");
const path = require("path");
const { HIDE_CHROME_INIT, launchChrome, mintCookies, wait } = require("./capture-lib");

const BASE = process.env.GUIDE_BASE || "http://localhost:3000";
const API = process.env.GUIDE_API || "http://localhost:8000/api/v1";
const ROOT = path.join(__dirname, "..", "frontend");
// A production build redirects every other host to vidit.app; a shot must never leave the local instance.
const isLocal = (url) => /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(new URL(url).hostname);
for (const url of [BASE, API]) if (!isLocal(url)) throw new Error(`${url} is not a local instance`);
const SHOTS = JSON.parse(fs.readFileSync(path.join(ROOT, "src/app/_shots/shots.json"), "utf8"));
const WEBP_QUALITY = 0.72;
const RADIUS = 15;
const GAP = 6;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const PREPARE = {
  layout: async (page) => {
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await wait(800);
  },
  "layout-phone": async (page) => {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await wait(800);
  },
  feed: async (page) => {
    const empty = page.getByText(/^(You follow no analysts yet|Nothing from analysts you follow yet)$/);
    if (await empty.count()) {
      await page.getByRole("group", { name: "Feed scope" }).getByRole("button", { name: "All" }).click();
      await wait(2500);
    }
  },
  notifications: async (page) => {
    const box = await page.getByRole("group", { name: "Accept approval requests from" }).boundingBox();
    await page.evaluate((dy) => window.scrollBy(0, dy), box.y - 115);
    await wait(500);
  },
  "submit-modes": async (page) => {
    await page.getByRole("group", { name: "Submission mode" }).getByRole("button", { name: "From an X post" }).click();
    await wait(800);
  },
};

function resolveRoute(route) {
  return route.replace(/\{(\w+)\}/g, (_, key) => {
    const name = `GUIDE_${key.toUpperCase()}`;
    if (!process.env[name]) throw new Error(`set ${name} (see the Guide screenshots section of video/README.md)`);
    return process.env[name];
  });
}

function centre(box, place) {
  const midY = box.y + box.height / 2;
  switch (place) {
    case "left":
      return { x: box.x - GAP - RADIUS, y: midY };
    case "right":
      return { x: box.x + box.width + GAP + RADIUS, y: midY };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height + GAP + RADIUS };
    case "top-left":
      return { x: box.x, y: box.y };
    case "top-right":
      return { x: box.x + box.width, y: box.y };
    default:
      throw new Error(`unknown place "${place}"`);
  }
}

// `bg-orange-500` is the accent in `frontend/src/components/ui/styles.ts`, so the
// disc takes the app's own orange from its stylesheet. The white ring keeps a
// marker apart from the map's orange cluster counts.
async function drawMarkers(page, points) {
  await page.evaluate(
    ({ points, radius }) => {
      for (const [i, { x, y }] of points.entries()) {
        const disc = document.createElement("div");
        disc.className = "bg-orange-500";
        disc.textContent = String(i + 1);
        disc.style.cssText =
          `position:fixed;left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px;` +
          "border-radius:9999px;display:flex;align-items:center;justify-content:center;z-index:2147483647;" +
          "color:#fff;font:700 16px/1 system-ui,sans-serif;box-shadow:0 0 0 2px #fff,0 2px 8px rgba(0,0,0,.6);";
        document.body.appendChild(disc);
      }
    },
    { points, radius: RADIUS },
  );
}

async function assertNoEmail(page, clip) {
  const hit = await page.evaluate(
    ({ clip, source }) => {
      const pattern = new RegExp(source);
      const inside = (r) =>
        r.right > clip.x && r.bottom > clip.y && r.left < clip.x + clip.width && r.top < clip.y + clip.height;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!pattern.test(node.textContent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (inside(r)) return node.textContent;
        }
      }
      for (const input of document.querySelectorAll("input")) {
        if (pattern.test(input.value) && inside(input.getBoundingClientRect())) return input.value;
      }
      return null;
    },
    { clip, source: EMAIL.source },
  );
  if (hit) throw new Error(`an email address is in the frame: "${hit.trim()}"`);
}

async function shoot(browser, folder, id, shot, cookies) {
  const ctx = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.dpr,
    isMobile: shot.viewport.width < 640,
    hasTouch: shot.viewport.width < 640,
  });
  if (shot.session === "signed-in") await ctx.addCookies(cookies);
  await ctx.addInitScript(HIDE_CHROME_INIT);
  const page = await ctx.newPage();
  await page.goto(BASE + resolveRoute(shot.route), { waitUntil: "networkidle" });
  if (!isLocal(page.url())) throw new Error(`${id}: left the local instance for ${page.url()}`);
  await wait(2500);
  if (PREPARE[id]) await PREPARE[id](page);

  const points = [];
  for (const { target, place } of shot.markers) {
    const box = await page.locator(target).first().boundingBox();
    if (!box) throw new Error(`${id}: no element for "${target}"`);
    points.push(centre(box, place));
  }
  const clip = { x: 0, y: 0, ...(shot.clip ?? shot.viewport) };
  await assertNoEmail(page, clip);
  await drawMarkers(page, points);
  await wait(200);

  const png = await page.screenshot({ clip, type: "png" });
  await ctx.close();
  const { webp, width, height } = await toWebp(browser, png);
  const out = path.join(ROOT, "public", folder);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, shot.file), webp);
  console.log(`  ${shot.file}  ${width}x${height}  ${Math.round(webp.length / 1024)} KB`);
}

// Playwright screenshots only as PNG or JPEG, so Chrome's own canvas encoder
// makes the WebP, which keeps the script free of an image toolchain.
async function toWebp(browser, png) {
  const page = await browser.newPage();
  const { data, width, height } = await page.evaluate(
    async ({ b64, quality }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const url = canvas.toDataURL("image/webp", quality);
      return { data: url.slice(url.indexOf(",") + 1), width: canvas.width, height: canvas.height };
    },
    { b64: png.toString("base64"), quality: WEBP_QUALITY },
  );
  await page.close();
  return { webp: Buffer.from(data, "base64"), width, height };
}

(async () => {
  const only = process.env.GUIDE_ONLY?.split(",");
  const queue = Object.entries(SHOTS).flatMap(([folder, shots]) =>
    Object.entries(shots)
      .filter(([id]) => !only || only.includes(id))
      .map(([id, shot]) => ({ folder, id, shot })),
  );
  let cookies = null;
  if (queue.some(({ shot }) => shot.session === "signed-in")) {
    const { GUIDE_LOGIN_EMAIL: email, GUIDE_LOGIN_PASSWORD: password } = process.env;
    if (!email || !password) throw new Error("set GUIDE_LOGIN_EMAIL and GUIDE_LOGIN_PASSWORD for the signed-in shots");
    ({ cookies } = await mintCookies(API, email, password));
  }
  const browser = await launchChrome({ headless: true, args: ["--use-angle=metal"] });
  try {
    for (const { folder, id, shot } of queue) await shoot(browser, folder, id, shot, cookies);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
