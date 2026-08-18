// Seed requests from a list of tweet URLs.
//
// For each tweet:
//   1. POST /events/import-from-tweet → creates detections and
//      answers their ids
//   2. GET /events/{id} → the detection's title, source, post instant, proof
//      and stored media
//   3. fetch each media file from its `storage_url` (the detections already
//      hold the bytes, so nothing re-reads the X CDN)
//   4. POST /events/requests multipart: title (from the detection's proof
//      text), source_url, source_posted_at, the classification ids, and
//      the one source file the row is born with
//   5. delete the detections the import created: they are working state for
//      this script, not part of the promo catalog
//
// PRECONDITION: the import reads the caller's OWN posts only, so the
// seeding account's linked X handle must be the author of `TWEETS` and
// `RECORDING_TWEET_URL`. See planning/next.md → "Give the promo pipeline
// its own user bootstrap".
//
// Idempotent: deletes the request author's and the recording viewer's
// prior "seeded request" rows before re-seeding so re-runs converge to
// the same state.
//
// Every route here lives under `/events`: a request is a `requested`
// event, not a resource of its own. `check-routes.sh` fails the build if
// a `/geolocations` or top-level `/requests` call comes back.

const { Blob } = require("node:buffer");

const API = "http://localhost:8000/api/v1";

// The list endpoints cap a page at 100 rows however large `limit` is, so
// the wipe helpers below re-list after each pass instead of trusting one
// page to hold everything.
const PAGE_LIMIT = 100;

// Requests are seeded from the same analyst's tweets — the framing in
// the promo is "this analyst's requests", a community-of-one demo.
// Tweets are ordered oldest-first; the request list sorts newest-first,
// so the LAST entry here lands at the top of the list and is what the
// recording clicks into. Both tweets here have known-good video media
// (the third candidate, 2058666432729170060, had a flaky video proxy
// and got dropped — the recording would otherwise click a request with
// image-only fallback, contradicting the "source footage" premise).
const TWEETS = [
  "https://x.com/geo27752/status/2059262323152286110",
  "https://x.com/geo27752/status/2059022802951311853",
];

// Classification the seeded requests carry. `CONFLICT_NAME` is a row of
// the conflicts referential, `CAPTURE_SOURCE_NAME` a curated tag; the
// recording picks the same two on the submit form, so change them
// together with the constants at the top of `record-submit.js`.
const CONFLICT_NAME = "Gaza war";
const CAPTURE_SOURCE_NAME = "Drone";

async function mintAuth(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const cookies = [];
  let csrf = null;
  for (const c of res.headers.getSetCookie()) {
    const m = c.match(/^(vidit_session|vidit_csrf)=([^;]+)/);
    if (m) {
      cookies.push({ name: m[1], value: m[2] });
      if (m[1] === "vidit_csrf") csrf = m[2];
    }
  }
  return {
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrf,
  };
}

// The paste entry: creates the detections the post carries and answers their
// ids under `created` / `updated` / `skipped`, plus `warnings` and a
// `reason` when it produced none.
async function importPost(auth, url) {
  const res = await fetch(`${API}/events/import-from-tweet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: auth.cookieHeader,
      "X-CSRF-Token": auth.csrf,
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`import ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// The first detection an import landed on, whichever verdict it fell under, or
// null when the post produced none.
function firstDetectionId(outcome) {
  return [...outcome.created, ...outcome.updated, ...outcome.skipped][0] || null;
}

async function readEvent(auth, id) {
  const res = await fetch(`${API}/events/${id}`, {
    headers: { cookie: auth.cookieHeader },
  });
  if (!res.ok) throw new Error(`read event ${id}: ${res.status}`);
  return res.json();
}

async function deleteEvent(auth, id) {
  const res = await fetch(`${API}/events/${id}`, {
    method: "DELETE",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
  });
  if (!res.ok && res.status !== 404) console.warn(`  skip delete ${id}: ${res.status}`);
}

// A detection's media is already stored, so the bytes come from the media host
// rather than from the X CDN. No auth: the objects are public reads.
async function fetchStoredMedia(storageUrl) {
  const res = await fetch(storageUrl);
  if (!res.ok) throw new Error(`media ${storageUrl}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "application/octet-stream";
  return { buf, type };
}

// The detection's proof body as plain text. The proof is a Tiptap document, and
// the import writes the thread's own words into it, which is the text the
// request title is built from.
function proofText(proof) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") out.push(node.text);
    if (node.type === "paragraph") out.push("\n");
    for (const child of node.content || []) walk(child);
  };
  walk(proof);
  return out.join("");
}

function titleFromTweetText(text, fallback) {
  // Build a clean request title from the analyst's tweet text:
  //   - strip t.co URLs (visible as garbage in the title)
  //   - strip "Geolocation: <coords>" — requests are unplaced events;
  //     having coordinates in the title contradicts the premise
  //   - strip "[mm:ss-mm:ss]" timestamps (they reference the source
  //     video segment, not useful in a list view)
  //   - clean trailing punctuation and collapse whitespace
  if (!text) return fallback;
  let cleaned = text.replace(/https?:\/\/t\.co\/\S+/g, "");
  // "Geolocation: 33.224172°N 35.548975°E" — eat the whole line. The
  // earlier `[^\n.;,]+` stopped at the first `.` (decimal point) and
  // left half the coordinates behind.
  cleaned = cleaned.replace(/Geolocation\s*:[^\n]*/gi, "");
  // Also catch bare coordinate strings without the "Geolocation:" prefix.
  cleaned = cleaned.replace(
    /\d{1,3}\.\d+\s*°?[NS][\s,]+\d{1,3}\.\d+\s*°?[EW]/gi,
    ""
  );
  cleaned = cleaned.replace(/\[\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*\]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Trim trailing punctuation left behind by the strips.
  cleaned = cleaned.replace(/[.\s,;–—-]+$/, "").trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 90) return cleaned;
  const cut = cleaned.slice(0, 90);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + "…";
}

// Classification is two referentials, not one tag list: conflicts live in
// `/conflicts`, capture sources are the curated rows of `/tags`. Both
// lookups warn loudly on a miss — silently dropping one would post
// requests with the wrong classification, and the recording's submit flow
// clicks the same names on the form and would miss too.
function warnMissing(kind, missing) {
  if (!missing.length) return;
  console.warn(
    `  WARN: ${kind} not found, skipping: ${missing.join(", ")} ` +
      `(make sure 'make seed' has run; if the referential was renamed, ` +
      `update the names at the top of seed-requests.js)`
  );
}

async function resolveIds(auth, path, names, kind) {
  const rows = await fetch(`${API}${path}`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const byName = new Map(rows.map((t) => [t.name, t.id]));
  warnMissing(kind, names.filter((n) => !byName.has(n)));
  return names.map((n) => byName.get(n)).filter(Boolean);
}

const getCuratedTagIds = (auth, names) =>
  resolveIds(auth, "/tags?curated=true", names, "curated tags");

const getConflictIds = (auth, names) =>
  resolveIds(auth, "/conflicts", names, "conflicts");

async function createRequest(
  auth,
  { title, sourceUrl, sourcePostedAt, tagIds, conflictIds, mediaFile }
) {
  const fd = new FormData();
  fd.append("title", title);
  fd.append("source_url", sourceUrl);
  // Required: a post always has an instant, and the row carries it from
  // birth so a fulfiller inherits it.
  fd.append("source_posted_at", sourcePostedAt);
  if (tagIds.length) fd.append("tag_ids", JSON.stringify(tagIds));
  if (conflictIds.length) fd.append("conflict_ids", JSON.stringify(conflictIds));
  // One source file per event (`file`, singular): the platform models a
  // request as an unfinished geolocation, so the evidence the poster has
  // sits on the row from the start.
  const { buf, type } = mediaFile;
  // Pick a filename + extension Playwright/the server will both accept.
  const ext =
    type.startsWith("video/") ? "mp4"
    : type === "image/jpeg" ? "jpg"
    : type === "image/png" ? "png"
    : "bin";
  fd.append("file", new Blob([buf], { type }), `media.${ext}`);
  const res = await fetch(`${API}/events/requests`, {
    method: "POST",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    body: fd,
  });
  if (!res.ok) throw new Error(`request ${title}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Cleanup helpers. The public `DELETE /events/{id}` enforces author-only
// access (admins can not delete other users' rows through the public
// endpoint), so per-user wipes still need that user's own auth. Only the
// cross-author tweet-duplicate wipe routes through the admin-only
// `DELETE /admin/events/{id}`, which bypasses `ensure_author`.

// One page of a lifecycle view, author-filtered server-side. `view`
// selects the queue: `requested` is the open-call board (ex `/requests`),
// `located` the catalog. A page holds at most 100 rows, which is why the
// wipes below loop rather than read a single page.
async function listMine(auth, username, view) {
  const res = await fetch(
    `${API}/events?view=${view}&author=${encodeURIComponent(username)}` +
      `&limit=${PAGE_LIMIT}`,
    { headers: { cookie: auth.cookieHeader } }
  );
  if (!res.ok) throw new Error(`list ${view} for ${username}: ${res.status}`);
  return res.json();
}

// Delete every row of one view authored by the caller. Re-lists after each
// page so a set larger than the 100-row cap drains fully; stops when a
// pass deletes nothing so an undeletable row can't spin the loop.
async function wipeUserView(auth, view, label) {
  const me = await fetch(`${API}/auth/me`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  let total = 0;
  for (;;) {
    const page = await listMine(auth, me.username, view);
    if (!page.length) break;
    let deleted = 0;
    for (const row of page) {
      const res = await fetch(`${API}/events/${row.id}`, {
        method: "DELETE",
        headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
      });
      if (res.ok) deleted++;
      else if (res.status !== 409) console.warn(`  skip ${row.id}: ${res.status}`);
    }
    total += deleted;
    if (!deleted) break;
  }
  if (total) console.log(`✓ wiped ${total} prior ${label} for ${me.username}`);
}

const wipeUserRequests = (auth) => wipeUserView(auth, "requested", "request(s)");
const wipeUserGeolocations = (auth) =>
  wipeUserView(auth, "located", "geolocation(s)");

// Wipe every event that the recording's tweet would resolve to as
// "possibly related" — same heuristic the submit form uses
// (`/events/possible-duplicates`). Routes the deletes through the
// `DELETE /admin/events/{id}` endpoint so cross-author rows
// (e.g. an old admin@vidit.app submission of the same tweet) actually
// get cleaned up; the public DELETE would 403 on those and the wipe
// would silently no-op, leaving the duplicate-warning card to fire on
// every re-record.
//
// The coordinate and the date come from the detection the import creates, so
// the import itself runs under `ownerAuth`, the account whose linked X
// handle authored the tweet: the paste reads its caller's own posts only.
// The detection is deleted again straight away; it exists here to answer
// "where and when is this tweet", not to appear in the promo catalog.
async function wipeTweetDuplicatesAs(adminAuth, ownerAuth, tweetUrl) {
  let outcome;
  try {
    outcome = await importPost(ownerAuth, tweetUrl);
  } catch (e) {
    console.warn(`  wipeTweetDuplicatesAs: could not import tweet, skipping: ${e.message}`);
    return;
  }
  const detectionId = firstDetectionId(outcome);
  if (!detectionId) {
    console.warn("  wipeTweetDuplicatesAs: tweet produced no detection, skipping");
    return;
  }
  const detection = await readEvent(ownerAuth, detectionId);
  for (const id of outcome.created) await deleteEvent(ownerAuth, id);
  const coord = detection.event_coords;
  const date = (detection.event_date || detection.detected_post_at || "").slice(0, 10);
  if (!coord || !date) {
    console.warn(
      "  wipeTweetDuplicatesAs: missing coords/date on tweet, skipping"
    );
    return;
  }
  const dups = await fetch(
    `${API}/events/possible-duplicates?lat=${coord.lat}&lng=${coord.lng}&event_date=${date}`,
    { headers: { cookie: adminAuth.cookieHeader } }
  ).then((r) => r.json());
  if (!dups.length) return;
  for (const g of dups) {
    const res = await fetch(`${API}/admin/events/${g.id}?hard=true`, {
      method: "DELETE",
      headers: {
        cookie: adminAuth.cookieHeader,
        "X-CSRF-Token": adminAuth.csrf,
      },
    });
    if (!res.ok && res.status !== 409) {
      console.warn(`  skip dup ${g.id}: ${res.status}`);
    }
  }
  console.log(`✓ wiped ${dups.length} prior tweet-duplicate(s)`);
}

// The tweet URL the recording posts a geolocation from. Kept in sync
// with `RECORDING_TWEET_URL` in `record-submit.js` — if you change one,
// change the other (or extract to a shared constants file).
const RECORDING_TWEET_URL =
  "https://x.com/geo27752/status/2060086984513626223";

(async () => {
  // Admin login handles the only wipe that needs cross-author reach:
  // possible-duplicate events near the recording's tweet, where
  // prior runs sometimes left rows authored by `admin@vidit.app`
  // itself. Per-user logins below handle each user's own rows via the
  // public DELETE (admin can't reach those without going through the
  // soft-delete admin path, which leaves orphan `deleted_at` rows).
  const admin = await mintAuth("admin@vidit.app", "admin");
  // The recording's tweet is the analyst's own post, so the import that
  // answers "where and when" runs under that account.
  const recorder = await mintAuth("analyst@vidit.app", "analyst");
  await wipeTweetDuplicatesAs(admin, recorder, RECORDING_TWEET_URL);

  // The request author is someone OTHER than the recording viewer, so the
  // detail page reads as a request you could pick up rather than one you
  // own (an owner sees "Close this request" instead of "Geolocate this").
  // The recording logs in as `analyst`, so `demo-analyst` owns the seeded
  // requests.
  const author = await mintAuth("demo-analyst@vidit.app", "demo-analyst");
  await wipeUserRequests(author);

  // The recording's `analyst` also posts a request + a geolocation
  // during the live "Post request" / "Submit geolocation" beats. Wipe
  // any prior copies from earlier recordings so they don't linger.
  await wipeUserRequests(recorder);
  await wipeUserGeolocations(recorder);

  const auth = author; // reuse the rest of this script unchanged
  // Conflict + capture-source — neither is part of the request floor, but
  // both are part of the downstream geolocation, and the cards read right
  // with them set. They come from two referentials: the conflict from
  // `/conflicts`, the capture source from the curated rows of `/tags`.
  const conflictIds = await getConflictIds(auth, [CONFLICT_NAME]);
  const tagIds = await getCuratedTagIds(auth, [CAPTURE_SOURCE_NAME]);

  for (const url of TWEETS) {
    console.log(`→ ${url}`);
    const outcome = await importPost(auth, url);
    const detectionId = firstDetectionId(outcome);
    if (!detectionId) {
      console.warn(`  no detection: ${outcome.reason?.message || "post produced none"}`);
      continue;
    }
    const detection = await readEvent(auth, detectionId);
    const title = titleFromTweetText(proofText(detection.proof), "Unplaced footage");
    console.log(`  title: ${title.slice(0, 60)}${title.length > 60 ? "…" : ""}`);
    console.log(`  media: ${detection.media.length}`);

    // One source file per event, so this picks a single attachment.
    // Prefer the detection's VIDEOS — a request is the analyst's source
    // footage that nobody's placed yet; the images are usually the
    // geolocator's annotated satellite stills, which contradict the
    // "unplaced footage" premise. Images stay as the fallback so one
    // unreadable object doesn't drop the request entirely.
    const videos = detection.media.filter((m) => m.media_type === "video");
    const candidates = [...videos, ...detection.media.filter((m) => m.media_type === "image")];
    let mediaFile = null;
    for (const m of candidates) {
      try {
        mediaFile = await fetchStoredMedia(m.storage_url);
        break;
      } catch (e) {
        console.warn(`  skip ${m.storage_url}: ${e.message}`);
      }
    }
    if (!mediaFile) {
      console.warn("  no media fetched, skipping request");
      continue;
    }
    if (!mediaFile.type.startsWith("video/") && videos.length) {
      console.warn("  video fetch failed; falling back to an image");
    }

    // The source's own post instant. The backend requires it: a source is
    // a post, and a post always has a time. The detection carries the source's
    // instant when the chase resolved one, else the analyst's own.
    const sourcePostedAt = detection.source_posted_at || detection.detected_post_at;
    if (!sourcePostedAt) {
      console.warn("  detection carries no post instant, skipping request");
      continue;
    }

    const request = await createRequest(auth, {
      title,
      sourceUrl: detection.source_url || detection.detected_from_url || url,
      sourcePostedAt,
      tagIds,
      conflictIds,
      mediaFile,
    });
    console.log(`  ✓ ${request.id}`);

    // The detections were the read path, not the promo state: the seeded
    // requests are what the recording shows, and a machine detection beside
    // them would put an unreviewed row on the map.
    for (const id of outcome.created) await deleteEvent(auth, id);
  }

  console.log("done");
})();
