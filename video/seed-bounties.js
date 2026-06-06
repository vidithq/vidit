// Seed bounties from a list of tweet URLs.
//
// For each tweet:
//   1. import-from-tweet → gets author, text, parsed media URLs
//   2. fetch each media URL via the import-from-tweet/media proxy
//      (X CDN doesn't set CORS; the proxy is the path the real form
//      uses too)
//   3. POST /bounties multipart: title (from tweet text), source_url
//      (canonical tweet URL), tags, files (the downloaded media)
//
// Idempotent: deletes the admin user's prior "seeded bounty" rows
// before re-seeding so re-runs converge to the same state.

const { Blob } = require("node:buffer");

const API = "http://localhost:8000/api/v1";

// Bounties are seeded from the same analyst's tweets — the framing in
// the promo is "this analyst's bounties", a community-of-one demo.
// Tweets are ordered oldest-first; the bounty list sorts newest-first,
// so the LAST entry here lands at the top of the list and is what the
// recording clicks into. Both tweets here have known-good video media
// (the third candidate, 2058666432729170060, had a flaky video proxy
// and got dropped — the recording would otherwise click a bounty with
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
  // Build a clean bounty title from the analyst's tweet text:
  //   - strip t.co URLs (visible as garbage in the title)
  //   - strip "Geolocation: <coords>" — bounties are unplaced events;
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
  // would let bounties post with the wrong (or empty) tag set, and the
  // recording's later submit flow would then click chips by the same
  // names and miss. Better to surface the rotation up front so the
  // operator either fixes the tag names here or the seeder for the
  // curated taxonomy.
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    console.warn(
      `  WARN: curated tags not found, skipping: ${missing.join(", ")} ` +
        `(make sure 'make seed' has run; if the curated taxonomy was ` +
        `renamed, update the tag names in seed-bounties.js)`
    );
  }
  return names.map((n) => byName.get(n)).filter(Boolean);
}

async function createBounty(auth, { title, sourceUrl, tagIds, mediaFiles }) {
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
  const res = await fetch(`${API}/bounties`, {
    method: "POST",
    headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    body: fd,
  });
  if (!res.ok) throw new Error(`bounty ${title}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function wipeUserBounties(auth) {
  // Delete every bounty owned by the currently-authenticated user.
  const me = await fetch(`${API}/users/me`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const all = await fetch(`${API}/bounties`, {
    headers: { cookie: auth.cookieHeader },
  }).then((r) => r.json());
  const mine = all.filter(
    (b) => b.author?.id === me.id || b.author?.username === me.username
  );
  for (const b of mine) {
    const res = await fetch(`${API}/bounties/${b.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookieHeader, "X-CSRF-Token": auth.csrf },
    });
    if (!res.ok && res.status !== 409) {
      console.warn(`  skip ${b.id}: ${res.status}`);
    }
  }
  if (mine.length) {
    console.log(`✓ wiped ${mine.length} prior bounty/bounties for ${me.username}`);
  }
}

(async () => {
  // The bounty author has to be someone OTHER than admin — the recording
  // logs in as admin, and the bounty detail page only shows "I'm working
  // on this" when the viewer is NOT the bounty's author.
  const author = await mintAuth("demo-analyst@vidit.app", "demo-analyst");
  await wipeUserBounties(author);

  // Admin's prior bounties (from older record-submit runs) too — they'd
  // otherwise linger in the list as ghost rows.
  const admin = await mintAuth("admin@vidit.app", "admin");
  await wipeUserBounties(admin);

  const auth = author; // reuse the rest of this script unchanged
  // Conflict + capture-source — every bounty needs both for the
  // downstream geolocation. Israel Gaza + Drone fit the source material.
  const tagIds = await getTagIds(auth, ["Israel Gaza", "Drone"]);

  for (const url of TWEETS) {
    console.log(`→ ${url}`);
    const tweet = await importTweet(auth, url);
    const title = titleFromTweetText(tweet.tweet_text, "Unplaced footage");
    console.log(`  title: ${title.slice(0, 60)}${title.length > 60 ? "…" : ""}`);
    console.log(`  media: ${tweet.media?.length || 0}`);

    // Prefer the tweet's VIDEOS for the bounty media — a bounty is the
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
    // back to them rather than dropping the bounty entirely.
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
      console.warn("  no media fetched, skipping bounty");
      continue;
    }

    const bounty = await createBounty(auth, {
      title,
      sourceUrl: tweet.original_tweet_url || url,
      tagIds,
      mediaFiles,
    });
    console.log(`  ✓ ${bounty.id}`);
  }

  // Pre-seed a single "I'm working on this" claim from analyst-helper
  // (a NON-admin user) so the list visibly shows "1 working" on one
  // bounty when admin opens the page in the recording. The recording's
  // admin then clicks "I'm working on this" on a *different* bounty
  // to demonstrate the action live.
  const helper = await mintAuth("analyst-helper@vidit.app", "analyst-helper");
  const all = await fetch(`${API}/bounties`, {
    headers: { cookie: helper.cookieHeader },
  }).then((r) => r.json());
  // Pick the second-newest so the newest still reads as "fresh" (and
  // gets the recording's live click).
  if (all.length >= 2) {
    const target = all[1];
    const res = await fetch(`${API}/bounties/${target.id}/claim`, {
      method: "POST",
      headers: { cookie: helper.cookieHeader, "X-CSRF-Token": helper.csrf },
    });
    console.log(`✓ analyst-helper claimed ${target.id} (${res.status})`);
  }
  console.log("done");
})();
