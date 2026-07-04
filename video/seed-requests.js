// Seed requests from a list of tweet URLs.
//
// For each tweet:
//   1. import-from-tweet → gets author, text, parsed media URLs
//   2. fetch each media URL via the import-from-tweet/media proxy
//      (X CDN doesn't set CORS; the proxy is the path the real form
//      uses too)
//   3. POST /requests multipart: title (from tweet text), source_url
//      (canonical tweet URL), tags, files (the downloaded media)
//
// Idempotent: deletes the request author's and the recording viewer's
// prior "seeded request" rows before re-seeding so re-runs converge to
// the same state.

const { Blob } = require("node:buffer");

const API = "http://localhost:8000/api/v1";

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

async function importTweet(auth, url) {
  const res = await fetch(`${API}/geolocations/import-from-tweet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: auth.cookieHeader,
      "X-CSRF-Token": auth.csrf,
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`import ${url}: ${res.status}`);
  return res.json();
}

async function fetchMediaViaProxy(auth, remoteUrl) {
  const proxyUrl = `${API}/geolocations/import-from-tweet/media?u=${encodeURIComponent(remoteUrl)}`;
  const res = await fetch(proxyUrl, { headers: { cookie: auth.cookieHeader } });
  if (!res.ok) throw new Error(`proxy ${remoteUrl}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "application/octet-stream";
  return { buf, type };
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

async function getTagIds(auth, names) {
  const tags = await fetch(`${API}/tags?curated=true`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const byName = new Map(tags.map((t) => [t.name, t.id]));
  // Warn loudly when a requested tag is missing — silently dropping it
  // would let requests post with the wrong (or empty) tag set, and the
  // recording's later submit flow would then click chips by the same
  // names and miss. Better to surface the rotation up front so the
  // operator either fixes the tag names here or the seeder for the
  // curated taxonomy.
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    console.warn(
      `  WARN: curated tags not found, skipping: ${missing.join(", ")} ` +
        `(make sure 'make seed' has run; if the curated taxonomy was ` +
        `renamed, update the tag names in seed-requests.js)`
    );
  }
  return names.map((n) => byName.get(n)).filter(Boolean);
}

async function createRequest(auth, { title, sourceUrl, tagIds, mediaFiles }) {
  const fd = new FormData();
  fd.append("title", title);
  fd.append("source_url", sourceUrl);
  if (tagIds.length) fd.append("tag_ids", JSON.stringify(tagIds));
  for (let i = 0; i < mediaFiles.length; i++) {
    const { buf, type } = mediaFiles[i];
    // Pick a filename + extension Playwright/the server will both accept.
    const ext =
      type.startsWith("video/") ? "mp4"
      : type === "image/jpeg" ? "jpg"
      : type === "image/png" ? "png"
      : "bin";
    fd.append("files", new Blob([buf], { type }), `media-${i}.${ext}`);
  }
  const res = await fetch(`${API}/requests`, {
    method: "POST",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    body: fd,
  });
  if (!res.ok) throw new Error(`request ${title}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Cleanup helpers. The public `DELETE /requests/{id}` and
// `DELETE /geolocations/{id}` enforce author-only access (admins can
// not delete other users' rows through the public endpoints), so
// per-user wipes still need that user's own auth. Only the
// cross-author tweet-duplicate wipe routes through the admin-only
// `DELETE /admin/geolocations/{id}`, which bypasses `ensure_author`.

async function wipeUserRequests(auth) {
  const me = await fetch(`${API}/auth/me`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const all = await fetch(`${API}/requests`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const mine = all.filter(
    (b) => b.author?.id === me.id || b.author?.username === me.username
  );
  for (const b of mine) {
    const res = await fetch(`${API}/requests/${b.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    });
    if (!res.ok && res.status !== 409) {
      console.warn(`  skip ${b.id}: ${res.status}`);
    }
  }
  if (mine.length) {
    console.log(`✓ wiped ${mine.length} prior request/requests for ${me.username}`);
  }
}

async function wipeUserGeolocations(auth) {
  const me = await fetch(`${API}/auth/me`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const list = await fetch(
    `${API}/geolocations?author=${encodeURIComponent(me.username)}&limit=200`,
    { headers: { cookie: auth.cookieHeader } }
  ).then((r) => r.json());
  const items = Array.isArray(list) ? list : list.items || [];
  for (const g of items) {
    const res = await fetch(`${API}/geolocations/${g.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    });
    if (!res.ok && res.status !== 409) {
      console.warn(`  skip geoloc ${g.id}: ${res.status}`);
    }
  }
  if (items.length) {
    console.log(`✓ wiped ${items.length} prior geolocation(s) for ${me.username}`);
  }
}

// Wipe every geolocation that the recording's tweet would resolve to
// as "possibly related" — same heuristic the submit form uses
// (`/geolocations/possible-duplicates`). Routes through the
// `DELETE /admin/geolocations/{id}` endpoint so cross-author rows
// (e.g. an old admin@vidit.app submission of the same tweet) actually
// get cleaned up; the public DELETE would 403 on those and the wipe
// would silently no-op, leaving the duplicate-warning card to fire on
// every re-record.
async function wipeTweetDuplicatesAs(adminAuth, tweetUrl) {
  const parsed = await fetch(`${API}/geolocations/import-from-tweet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminAuth.cookieHeader,
      "X-CSRF-Token": adminAuth.csrf,
    },
    body: JSON.stringify({ url: tweetUrl }),
  }).then((r) => (r.ok ? r.json() : null));
  if (!parsed) {
    console.warn("  wipeTweetDuplicatesAs: could not parse tweet, skipping");
    return;
  }
  const coord = parsed.parsed_coords?.[0];
  const date = parsed.posted_at?.slice(0, 10);
  if (!coord || !date) {
    console.warn(
      "  wipeTweetDuplicatesAs: missing coords/date on tweet, skipping"
    );
    return;
  }
  const dups = await fetch(
    `${API}/geolocations/possible-duplicates?lat=${coord.lat}&lng=${coord.lng}&event_date=${date}`,
    { headers: { cookie: adminAuth.cookieHeader } }
  ).then((r) => r.json());
  if (!dups.length) return;
  for (const g of dups) {
    const res = await fetch(`${API}/admin/geolocations/${g.id}?hard=true`, {
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
  // possible-duplicate geolocations near the recording's tweet, where
  // prior runs sometimes left rows authored by `admin@vidit.app`
  // itself. Per-user logins below handle each user's own rows via the
  // public DELETE (admin can't reach those without going through the
  // soft-delete admin path, which leaves orphan `deleted_at` rows).
  const admin = await mintAuth("admin@vidit.app", "admin");
  await wipeTweetDuplicatesAs(admin, RECORDING_TWEET_URL);

  // The request author has to be someone OTHER than the recording
  // viewer — the request detail page only shows "I'm working on this"
  // when the viewer is NOT the request's author. The recording logs in
  // as `analyst`, so `demo-analyst` owns the seeded requests.
  const author = await mintAuth("demo-analyst@vidit.app", "demo-analyst");
  await wipeUserRequests(author);

  // The recording's `analyst` also posts a request + a geolocation
  // during the live "Post request" / "Submit geolocation" beats. Wipe
  // any prior copies from earlier recordings so they don't linger.
  const recorder = await mintAuth("analyst@vidit.app", "analyst");
  await wipeUserRequests(recorder);
  await wipeUserGeolocations(recorder);

  const auth = author; // reuse the rest of this script unchanged
  // Conflict + capture-source — every request needs both for the
  // downstream geolocation. Israel Gaza + Drone fit the source material.
  const tagIds = await getTagIds(auth, ["Israel Gaza", "Drone"]);

  for (const url of TWEETS) {
    console.log(`→ ${url}`);
    const tweet = await importTweet(auth, url);
    const title = titleFromTweetText(tweet.tweet_text, "Unplaced footage");
    console.log(`  title: ${title.slice(0, 60)}${title.length > 60 ? "…" : ""}`);
    console.log(`  media: ${tweet.media?.length || 0}`);

    // Prefer the tweet's VIDEOS for the request media — a request is the
    // analyst's source footage that nobody's placed yet; the images
    // attached to the tweet are usually the geolocator's annotated
    // satellite stills, which contradict the "unplaced footage"
    // premise. Fall back to all media only if no videos are present.
    const allMedia = tweet.media || [];
    const videos = allMedia.filter((m) => m.kind === "video");
    const preferred = videos.length ? videos : allMedia;
    const mediaFiles = [];
    for (const m of preferred) {
      try {
        const fetched = await fetchMediaViaProxy(auth, m.remote_url);
        mediaFiles.push(fetched);
      } catch (e) {
        console.warn(`  skip ${m.remote_url}: ${e.message}`);
      }
    }
    // If video fetch failed and we have images on the same tweet, fall
    // back to them rather than dropping the request entirely.
    if (!mediaFiles.length && videos.length && allMedia.length > videos.length) {
      console.warn("  video fetch failed; falling back to images");
      for (const m of allMedia.filter((m) => m.kind === "image")) {
        try {
          const fetched = await fetchMediaViaProxy(auth, m.remote_url);
          mediaFiles.push(fetched);
        } catch (e) {
          console.warn(`  skip ${m.remote_url}: ${e.message}`);
        }
      }
    }
    if (!mediaFiles.length) {
      console.warn("  no media fetched, skipping request");
      continue;
    }

    const request = await createRequest(auth, {
      title,
      sourceUrl: tweet.original_tweet_url || url,
      tagIds,
      mediaFiles,
    });
    console.log(`  ✓ ${request.id}`);
  }

  // Pre-seed a single "I'm working on this" claim from analyst-helper
  // (a separate non-admin user) so the list visibly shows "1 working"
  // on one request when the recording viewer opens the page. The
  // recording then clicks "I'm working on this" on a *different*
  // request to demonstrate the action live.
  const helper = await mintAuth("analyst-helper@vidit.app", "analyst-helper");
  const all = await fetch(`${API}/requests`, {
    headers: { cookie: helper.cookieHeader },
  }).then((r) => r.json());
  // Pick the second-newest so the newest still reads as "fresh" (and
  // gets the recording's live click).
  if (all.length >= 2) {
    const target = all[1];
    const res = await fetch(`${API}/requests/${target.id}/claim`, {
      method: "POST",
      headers: { cookie: helper.cookieHeader, "X-CSRF-Token": helper.csrf },
    });
    console.log(`✓ analyst-helper claimed ${target.id} (${res.status})`);
  }
  console.log("done");
})();
