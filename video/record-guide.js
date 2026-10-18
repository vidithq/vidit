// The Getting started walkthrough: a tour of the six sections of `/guide`,
// recorded SIGNED IN against a running instance, in two takes.
//
//   guide.mp4        the desktop take: the rail, one geolocation's page, the
//                    three statuses in search, the import guide and the submit
//                    form, approvals and credit, an organization, following
//                    and the feed, the profile and the notification settings.
//   guide-phone.mp4  the phone take: the chip at the top left and the drawer
//                    it opens.
//
// The comp (`src/GuideWalkthrough.tsx`) is CUT, unlike the promos: it plays
// one window of a take per scene, so each scene runs from one mark of the take
// to another. A page reached by `page.goto` (a reload, with its white frame)
// opens a new scene, and every mark that opens a scene is stamped only once the
// page has settled, so the reload never reaches the film. Inside a scene the
// changes are in-page pushes the app performs (a rail entry, the Edit control),
// so the route swaps under a still camera. A silent warm-up pass visits every
// route first, so the dev server's first-visit compile happens off camera.
//
// Scenes, in the order of `/guide`, with the marks that bound them:
//   1. The layout: `layout` to `layoutEnd`, the rail expanded and each entry
//      hovered (map, requests, feed, search, then notifications and settings),
//      then the phone take, `phone` to `phoneEnd`.
//   2. Reading a geolocation: `event` to `eventEnd`, the session's own
//      published event read top to bottom (source media, coordinates, the
//      source with its archived copy, the proof), then the byline, the version
//      menu and the Approvals card.
//   3. The three statuses: `statuses` to `statusesEnd`, search scoped to the
//      session's own events, one card of each status hovered.
//   4. Bringing your work in: `import` to `importEnd`, the three tiles of the
//      import guide, then Submit from the rail and its three modes.
//   5. Working with others: `approve` to `approveEnd` (the Approve control on
//      someone else's event), `request` to `requestEnd` (Request approval on
//      the session's event, then the edit page's Invite a geolocator field),
//      `organization` to `organizationEnd`, and `follow` to `feedEnd` (the
//      Follow control, then Feed from the rail).
//   6. Your settings: `profile` to `profileEnd` (Edit profile, then Cancel)
//      and `settings` to `settingsEnd` (who may send approval requests, and
//      the channel switches per kind).
//
// The clips land in public/clips/ with their marks in meta.json;
// `gen-clips-manifest.js` compiles those into src/clips-manifest.ts and the
// comp reads the marks to place its scenes, captions and address bar.
//
// Three rules this take enforces, all editorial:
//
//   1. Nothing is written. Every control the take presses opens a menu, a mode
//      or an edit state the app keeps in the page, and the take leaves each one
//      the way it found it (Escape, Cancel). Approve, Request approval, Follow,
//      Invite and the settings switches are hovered, never clicked. That is what
//      makes the take safe to re-run against the same instance.
//   2. Consenting accounts only. The session's own pages carry most beats. The
//      other analysts on camera are the ones the env vars name: the author of
//      GUIDE_APPROVE_EVENT, GUIDE_FOLLOW_HANDLE and the members of
//      GUIDE_ORGANIZATION. Get their consent first. The feed shows what the
//      session follows, so record with an account that follows only analysts
//      who agreed. No picker is opened, so no suggestion list names anyone else.
//   3. No private data. The settings page opens on the Account card, which
//      carries the session's email address, so the take jumps past it before
//      the scene's first mark and refuses to finish if the address was ever in
//      the window while that scene ran.
//
// The take checks its targets before it captures a frame (`verifyTargets`),
// and every check names the beat that needs it.
//
// Usage: node record-guide.js       (the instance must already be running)

const fs = require("fs");
const path = require("path");
const { proofText } = require("./proof-html");
const {
  wait,
  mintCookies,
  apiCall,
  slowScrollToY,
  slowScrollToLocator,
  smoothScrollIntoView,
  glideHover,
  glideAndClick,
  createRecorder,
} = require("./capture-lib");

const BASE = process.env.PROMO_BASE || "http://localhost:3000";
const API = process.env.PROMO_API || "http://localhost:8000/api/v1";
const FPS = 60;
const CAPTURE_DPR = 2;

// Every target is named by the person running the shoot: the session, and the
// accounts that agreed to appear. None has a default, because a default would
// film whoever it happens to name.
const ENV = {
  loginEmail: "GUIDE_LOGIN_EMAIL",
  loginPassword: "GUIDE_LOGIN_PASSWORD",
  event: "GUIDE_EVENT",
  approveEvent: "GUIDE_APPROVE_EVENT",
  organization: "GUIDE_ORGANIZATION",
  followHandle: "GUIDE_FOLLOW_HANDLE",
};

function readEnv() {
  const missing = Object.values(ENV).filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`set ${missing.join(", ")} (see the GuideWalkthrough section of video/README.md)`);
  }
  return Object.fromEntries(Object.entries(ENV).map(([key, name]) => [key, process.env[name]]));
}

// Both windows are the browser body the comp draws them in, at the CSS size
// that body occupies in a 1920x1080 frame: 830 px tall once the chrome header,
// the top margin and the caption band are taken out. The comp derives each
// body width from these aspects, so both takes play at scale 1, the reasoning
// `record-collections.js` sets out for the same geometry.
//
// 1392 wide keeps the desktop layout with the right rail beside the column
// (the rail shows from `lg`, 1024).
//
// 600 is under the `sm` breakpoint (640), where the rail turns into the chip
// and the drawer, so the phone take films the phone layout. It is wider than a
// phone because the comp's browser chrome needs about 590 px for its address
// bar, and a narrower window would clip it.
const DESKTOP = { width: 1392, height: 830 };
const PHONE = { width: 600, height: 830 };

const CLIPS_DIR = path.join(__dirname, "public", "clips");
const META_PATH = path.join(CLIPS_DIR, "meta.json");

// ─── pacing ──────────────────────────────────────────────────────────────
//
// The film runs about 90 seconds, so each sub-beat gets the time one caption
// needs to be read and no more. Every hold is real time on screen inside its
// scene, so lengthening one lengthens the video.
const HOLD_SHORT = 800;
const HOLD = 1300;
const HOLD_LONG = 1900;
const HOVER = 900;
const SCROLL_MS = 800;

const recorderFor = (viewport) =>
  createRecorder({
    clipsDir: CLIPS_DIR,
    metaPath: META_PATH,
    outDir: path.join(__dirname, "out"),
    fps: FPS,
    dpr: CAPTURE_DPR,
    viewport,
    // Drawn at scale 1, so the intermediate has no downscale to hide behind.
    crf: 13,
  });
const recordDesktop = recorderFor(DESKTOP);
const recordPhone = recorderFor(PHONE);

// ─── preflight ───────────────────────────────────────────────────────────

let AUTH = null;
const get = (pathname) => apiCall(API, AUTH, "GET", pathname);

async function verifyTargets(env) {
  const me = await get("/auth/me");
  const problems = [];

  // Scene 2 and the request beat of scene 5: the session's own published
  // event, so the page carries the owner's Edit control, the version menu and
  // the approval requests section.
  const event = await get(`/events/${env.event}`);
  const media = (Array.isArray(event.media) ? event.media : [event.media]).filter(Boolean);
  if (event.owner.id !== me.id) problems.push(`${env.event} belongs to ${event.owner.username}, not to ${me.username}`);
  if (event.status !== "geolocated") problems.push(`${env.event} is ${event.status}, not geolocated`);
  if (!media.some((m) => m.role === "source")) problems.push(`${env.event} has no source media`);
  if (!event.event_coords) problems.push(`${env.event} has no coordinates, so the page has no Location block`);
  if (!event.archived_source) problems.push(`${env.event} has no archived copy of its source`);
  if (proofText(event.proof).length < 200) problems.push(`${env.event} has a proof too short to read`);
  // The version beat says older versions stay readable, so the menu needs one.
  if (event.version_no < 2) problems.push(`${env.event} has one version, so the version menu lists nothing older`);
  const ownApprovals = await get(`/events/${env.event}/approvals?all_versions=true`);
  const standing = ownApprovals.items.filter((a) => a.version_no === event.version_no && !a.revoked_at);
  if (!standing.length) problems.push(`${env.event} has no approval on its live version, so the card reads No approvals yet`);

  // The approve beat: someone else's event that the session may still approve,
  // so the card renders the Approve control.
  const other = await get(`/events/${env.approveEvent}`);
  const otherApprovals = await get(`/events/${env.approveEvent}/approvals?all_versions=true`);
  const approvedAlready = otherApprovals.items.some(
    (a) => a.version_no === other.version_no && !a.organization && a.reviewer?.id === me.id && !a.revoked_at
  );
  if (!otherApprovals.viewer_can_approve) problems.push(`${me.username} may not approve ${env.approveEvent}`);
  if (approvedAlready) problems.push(`${me.username} already approved ${env.approveEvent}, so the card shows Revoke`);

  // The organization beat holds on its members and on the approvals given in
  // its name.
  const org = await get(`/organizations/${encodeURIComponent(env.organization)}`);
  const orgApprovals = await get(`/organizations/${encodeURIComponent(env.organization)}/approvals`);
  if (!orgApprovals.length) problems.push(`${org.name} has given no approval, so its Approvals block is empty`);

  if (env.followHandle === me.username) problems.push("GUIDE_FOLLOW_HANDLE names the session itself, which has no Follow control");
  await get(`/users/${encodeURIComponent(env.followHandle)}`);

  // Scene 3: one card of each status in the session's own events, on the first
  // page the search returns (the page asks for 20 per group, see
  // `lib/search.search`).
  const hits = await get(`/search?${statusQuery(me.username, true)}`);
  const firstOf = (status) => hits.geolocations.find((g) => g.status === status)?.id;
  const statusIds = {
    detected: firstOf("detected"),
    geolocated: firstOf("geolocated"),
    requested: hits.requests[0]?.id,
  };
  for (const [status, id] of Object.entries(statusIds)) {
    if (!id) problems.push(`no ${status} event of ${me.username}'s on the first page of the search`);
  }

  console.log(`→ signed in as ${me.username}`);
  console.log(`  event: ${event.title} (v${event.version_no}, ${standing.length} approvals)`);
  console.log(`  approve: ${other.title} by ${other.owner.username}`);
  console.log(`  organization: ${org.name}; follow: ${env.followHandle}`);
  if (problems.length) {
    throw new Error(`the guide take cannot be recorded:\n  - ${problems.join("\n  - ")}`);
  }
  return { me, event, statusIds };
}

function statusQuery(username, api) {
  const params = new URLSearchParams({ type: "event", author: username });
  if (api) {
    params.set("q", "");
    params.set("limit", "20");
  }
  return params.toString();
}

// ─── page helpers ────────────────────────────────────────────────────────

async function imagesLoaded(page) {
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20000 })
    .catch(() => {});
}

async function mapReady(page) {
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas.maplibregl-canvas");
      return c && c.clientWidth > 0 && !!window.__viditMap;
    },
    { timeout: 30000 }
  );
}

// A scene's opening: the reload, every landmark the scene frames, the images,
// then a moment for the layout to stop moving. The scene's first mark comes
// after this, so none of it is on film.
async function arrive(page, url, landmarks) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  for (const landmark of landmarks) {
    if (typeof landmark === "function") await landmark(page);
    else await landmark.waitFor({ timeout: 30000 });
  }
  await imagesLoaded(page);
  await wait(700);
}

// Glide onto a control, scrolling it into view first when it sits outside the
// window (a rail card below the fold, a card further down a list).
async function hoverInView(page, locator, hold) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  if (!box || box.y < 0 || box.y + box.height > vp.height) {
    await smoothScrollIntoView(page, locator, 900);
  }
  await glideHover(page, locator, { steps: 28, hold });
}

// The settings scene's privacy guard: true while any element whose whole text
// is the session's email address shows inside the window.
const emailInView = (page, email) =>
  page.evaluate((address) => {
    const el = [...document.querySelectorAll("p, span")].find((n) => n.textContent.trim() === address);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }, email);

// ─── the desktop take ────────────────────────────────────────────────────

async function clipGuide(env, { me, event, statusIds }) {
  const urls = {
    map: `${BASE}/map`,
    event: `${BASE}/events/${env.event}`,
    statuses: `${BASE}/search?${statusQuery(me.username, false)}`,
    import: `${BASE}/import`,
    approve: `${BASE}/events/${env.approveEvent}`,
    edit: `${BASE}/events/${env.event}/edit`,
    organization: `${BASE}/organizations/${encodeURIComponent(env.organization)}`,
    follow: `${BASE}/profile/${encodeURIComponent(env.followHandle)}`,
    feed: `${BASE}/feed`,
    profile: `${BASE}/profile/${encodeURIComponent(me.username)}`,
    settings: `${BASE}/settings`,
    submit: `${BASE}/submit`,
  };

  await recordDesktop("guide", { cookies: AUTH.cookies }, async (page, rec) => {
    const rail = (href) => page.locator(`aside[aria-label="Primary navigation"] a[href="${href}"]`);
    const heading = (name, level) => page.getByRole("heading", level ? { name, level } : { name });
    const sourceMedia = heading("Source media");
    const approvalsCard = page.locator('section[aria-label="Approvals"]');
    const approveButton = approvalsCard.getByRole("button", { name: "Approve", exact: true });
    const requestButton = approvalsCard.getByRole("button", { name: "Request approval" });
    // The rail's own Edit link: `useEventActions` names it `Edit`, and the
    // version menu's trigger ends in `choose a version`.
    const editLink = page.locator('[aria-label="Event actions"] a[aria-label="Edit"]');
    const versionMenu = page.locator('button[aria-label$=": choose a version"]');
    // The name link, not the avatar beside it, which carries an aria-label.
    const byline = page.locator(`header a[href="/profile/${encodeURIComponent(event.owner.username)}"]:not([aria-label])`);
    const inviteField = page.getByLabel("Invite a geolocator");
    const modes = page.getByRole("group", { name: "Submission mode" });
    const followButton = page.getByRole("button", { name: /^(Follow|Following)$/ });
    const editProfile = page.locator('button[aria-label="Edit profile"]');
    const notifications = heading("Notifications", 2);
    const audience = page.locator('[role="group"][aria-label="Accept approval requests from"]');
    const emailSwitch = page.locator('[role="switch"][aria-label$=", Email"]').first();
    const pushSwitch = page.locator('[role="switch"][aria-label$=", Push"]').first();
    const card = (href) => page.locator(`a[href="${href}"]`).first();

    // ── warm-up pass (silent) ────────────────────────────────────────────
    console.log("→ warm-up pass: compile the routes, fill the tile cache");
    await arrive(page, urls.map, [mapReady]);
    await wait(2500);
    await arrive(page, urls.event, [sourceMedia, approvalsCard]);
    await arrive(page, urls.statuses, [card(`/events/${statusIds.detected}`)]);
    await arrive(page, urls.import, [heading("Three ways in")]);
    await arrive(page, urls.submit, [modes]);
    await arrive(page, urls.approve, [approveButton]);
    await arrive(page, urls.edit, [inviteField]);
    await arrive(page, urls.organization, [heading("Members")]);
    await arrive(page, urls.follow, [followButton]);
    await arrive(page, urls.feed, [heading("Feed", 1)]);
    await arrive(page, urls.profile, [editProfile]);
    await arrive(page, urls.settings, [notifications]);

    // ── the recorded pass ────────────────────────────────────────────────
    console.log("→ recorded pass");
    await arrive(page, urls.map, [mapReady]);
    await wait(1500);
    rec.start();

    // 1. The layout. The rail opens collapsed to its icons, so the take
    //    expands it first and the labels name each entry as the cursor passes.
    console.log("→ the rail");
    rec.mark("layout");
    await wait(HOLD);
    rec.mark("railExpand");
    await glideAndClick(page, page.locator('button[aria-label="Expand sidebar"]'), { steps: 30, settle: 300 });
    await wait(600);
    for (const [key, href] of [
      ["railMap", "/map"],
      ["railRequests", "/requests"],
      ["railFeed", "/feed"],
      ["railSearch", "/search"],
      ["railNotifications", "/notifications"],
      ["railSettings", "/settings"],
    ]) {
      rec.mark(key);
      await glideHover(page, rail(href), { steps: 16, hold: HOVER });
    }
    await wait(HOLD_SHORT);
    rec.mark("layoutEnd");

    // 2. Reading a geolocation, in the page's own order: the source media, the
    //    Location block with the coordinates, the Details block with the source
    //    and its archived copy, the proof. Then back up for what the header and
    //    the rail say about the record: the byline, the versions, the approvals.
    console.log("→ the event page");
    await arrive(page, urls.event, [sourceMedia, approvalsCard]);
    await page
      .waitForFunction(() => {
        const v = document.querySelector("video");
        return !v || v.readyState >= 2;
      }, { timeout: 15000 })
      .catch(() => {});
    rec.mark("event");
    await wait(HOLD_LONG);
    rec.mark("eventCoords");
    await slowScrollToLocator(page, heading("Location"), SCROLL_MS, 90);
    await wait(HOLD);
    rec.mark("eventSource");
    await slowScrollToLocator(page, heading("Details"), SCROLL_MS, 90);
    await hoverInView(page, page.locator('a[aria-label*="copy of the source"]'), HOLD);
    rec.mark("eventProof");
    await slowScrollToLocator(page, heading("Proof"), SCROLL_MS, 90);
    await wait(HOLD_LONG);
    rec.mark("eventByline");
    await slowScrollToY(page, 0, SCROLL_MS);
    await glideHover(page, byline, { steps: 30, hold: HOLD });
    rec.mark("eventVersions");
    await glideAndClick(page, versionMenu, { steps: 24, settle: 300 });
    await wait(HOLD);
    await page.keyboard.press("Escape");
    await wait(300);
    rec.mark("eventApprovals");
    await hoverInView(page, approvalsCard, HOLD_LONG);
    rec.mark("eventEnd");

    // 3. The three statuses, one card of each among the session's own events.
    //    The preflight picked the cards, so each hover lands on the status the
    //    caption names.
    console.log("→ the three statuses");
    await arrive(page, urls.statuses, [card(`/events/${statusIds.detected}`)]);
    rec.mark("statuses");
    await wait(HOLD);
    rec.mark("statusDetected");
    await hoverInView(page, card(`/events/${statusIds.detected}`), HOLD_LONG);
    rec.mark("statusGeolocated");
    await hoverInView(page, card(`/events/${statusIds.geolocated}`), HOLD_LONG);
    rec.mark("statusRequested");
    await hoverInView(page, card("/requests/" + statusIds.requested), HOLD_LONG);
    rec.mark("statusesEnd");

    // 4. Bringing your work in: the three tiles of the import guide, then the
    //    rail's Submit entry and the form's three modes. A mode is page state,
    //    and nothing on any of them is filled in.
    console.log("→ the import guide and the submit form");
    await arrive(page, urls.import, [heading("Three ways in")]);
    rec.mark("import");
    await wait(HOLD_SHORT);
    await slowScrollToLocator(page, heading("Three ways in"), SCROLL_MS, 120);
    for (const [key, href] of [
      ["importArchive", "#archive"],
      ["importPaste", "#paste"],
      ["importBot", "#bot"],
    ]) {
      rec.mark(key);
      await glideHover(page, page.locator(`a[href="${href}"]`), { steps: 24, hold: HOLD });
    }
    rec.mark("submitClick");
    await glideAndClick(page, rail("/submit"), { steps: 30, settle: 300 });
    await page.waitForURL("**/submit", { timeout: 30000 });
    rec.mark("submitUrl");
    await modes.waitFor({ timeout: 30000 });
    await wait(HOLD_LONG);
    rec.mark("submitXPost");
    await glideAndClick(page, modes.getByRole("button", { name: "From an X post" }), { steps: 26, settle: 300 });
    await wait(HOLD);
    rec.mark("submitBulk");
    await glideAndClick(page, modes.getByRole("button", { name: "Bulk import" }), { steps: 14, settle: 300 });
    await wait(HOLD_LONG);
    rec.mark("importEnd");

    // 5. Working with others. Approve on someone else's event, Request approval
    //    on the session's own, the co-geolocator invite on its edit page, an
    //    organization, then Follow and the feed. Every control is hovered.
    console.log("→ approvals, credit, organizations, following");
    await arrive(page, urls.approve, [approveButton]);
    rec.mark("approve");
    await wait(HOLD_SHORT);
    await hoverInView(page, approveButton, HOLD_LONG);
    rec.mark("approveEnd");

    await arrive(page, urls.event, [sourceMedia, requestButton]);
    rec.mark("request");
    await wait(HOLD_SHORT);
    await hoverInView(page, requestButton, HOLD_LONG);
    rec.mark("editClick");
    await glideAndClick(page, editLink, { steps: 30, settle: 300 });
    await page.waitForURL("**/edit", { timeout: 30000 });
    rec.mark("editUrl");
    await inviteField.waitFor({ timeout: 30000 });
    await wait(HOLD_SHORT);
    await hoverInView(page, inviteField, HOLD_LONG);
    rec.mark("requestEnd");

    await arrive(page, urls.organization, [heading("Members")]);
    rec.mark("organization");
    await wait(HOLD);
    rec.mark("orgApprovals");
    await slowScrollToLocator(page, heading("Approvals", 2), SCROLL_MS, 120);
    await wait(HOLD_LONG);
    rec.mark("organizationEnd");

    await arrive(page, urls.follow, [followButton]);
    rec.mark("follow");
    await wait(HOLD_SHORT);
    await glideHover(page, followButton, { steps: 30, hold: HOLD_LONG });
    rec.mark("feedClick");
    await glideAndClick(page, rail("/feed"), { steps: 30, settle: 300 });
    await page.waitForURL("**/feed", { timeout: 30000 });
    rec.mark("feedUrl");
    await heading("Feed", 1).waitFor({ timeout: 30000 });
    await imagesLoaded(page);
    await wait(HOLD);
    await slowScrollToY(page, 420, SCROLL_MS * 1.5);
    await wait(HOLD);
    rec.mark("feedEnd");

    // 6. Your settings. The profile is edited on the profile itself: Edit
    //    profile opens the fields in place and Cancel closes them unsaved.
    console.log("→ the profile and the settings");
    await arrive(page, urls.profile, [heading(me.username, 1), editProfile]);
    rec.mark("profile");
    await wait(HOLD_SHORT);
    rec.mark("profileEdit");
    await glideAndClick(page, editProfile, { steps: 30, settle: 300 });
    await wait(HOLD_LONG);
    await glideAndClick(page, page.getByRole("button", { name: "Cancel", exact: true }).first(), {
      steps: 24,
      settle: 300,
    });
    await wait(HOLD_SHORT);
    rec.mark("profileEnd");

    // The settings page opens on the Account card and its email address, so
    // the jump to the Notifications card happens before the scene's first
    // mark, and nothing below scrolls back up.
    await arrive(page, urls.settings, [notifications]);
    await notifications.evaluate((el) => {
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 40);
    });
    await wait(500);
    if (await emailInView(page, me.email)) {
      throw new Error("the settings scene would open with the email address in frame");
    }
    rec.mark("settings");
    await wait(HOLD_SHORT);
    rec.mark("settingsAudience");
    await glideHover(page, audience, { steps: 30, hold: HOLD_LONG });
    rec.mark("settingsMatrix");
    await glideHover(page, emailSwitch, { steps: 28, hold: HOVER });
    await glideHover(page, pushSwitch, { steps: 14, hold: HOLD });
    if (await emailInView(page, me.email)) {
      throw new Error("the email address came into frame during the settings scene; do not publish this take");
    }
    rec.mark("settingsEnd");
    await wait(400);
  });
}

// ─── the phone take ──────────────────────────────────────────────────────

async function clipPhone() {
  await recordPhone("guide-phone", { cookies: AUTH.cookies }, async (page, rec) => {
    const open = page.locator('button[aria-label="Open navigation"]');
    // The foot control, named apart from the scrim (`Close navigation overlay`).
    const close = page.locator('button[aria-label="Close navigation"]');

    console.log("→ warm-up pass");
    await arrive(page, `${BASE}/map`, [mapReady, open]);
    await wait(2500);

    console.log("→ recorded pass: the chip and the drawer");
    await arrive(page, `${BASE}/map`, [mapReady, open]);
    await wait(1500);
    rec.start();
    rec.mark("phone");
    await wait(HOLD_LONG);
    rec.mark("drawerOpen");
    await glideAndClick(page, open, { steps: 30, settle: 300 });
    await wait(HOLD_LONG);
    rec.mark("drawerClose");
    await glideAndClick(page, close, { steps: 30, settle: 300 });
    await wait(HOLD);
    rec.mark("phoneEnd");
    await wait(400);
  });
}

(async () => {
  const env = readEnv();
  AUTH = await mintCookies(API, env.loginEmail, env.loginPassword);
  const targets = await verifyTargets(env);
  await clipGuide(env, targets);
  await clipPhone();
  console.log("\n✓ guide takes recorded (nothing was written to the instance)");
  console.log(fs.readFileSync(META_PATH, "utf8"));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
