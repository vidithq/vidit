// Build a real-shaped synthetic X archive zip for the v0.4 promo's bulk
// import beat. Layout matches an actual "Download your data" export subset:
//   tweets.js                 window.YTD.tweets.part0 = [ ... ]
//   tweets_media/{id}-{base}  one file per photo entry
//
// Every run mints fresh tweet ids (timestamp-prefixed), so re-recording the
// promo always creates NEW detections instead of dedup-skipping against the
// previous run (`_disposition` keys on detected_from_url + coordinate).
//
// The media jpgs are generated once with ffmpeg (dark gradient stills) into a
// cache dir and copied per tweet id. Nothing here fakes app UI; these are the
// archive's media payloads.
//
// Usage: node gen-archive.js            (writes out/vidit-demo-archive.zip)
//        require("./gen-archive").generate()   → { zipPath, coordCount, total }

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "out");
const CACHE_DIR = path.join(OUT_DIR, "archive-media-cache");
const STAGE_DIR = path.join(OUT_DIR, "demo-archive");
const ZIP_PATH = path.join(OUT_DIR, "vidit-demo-archive.zip");
const PROOF_IMG = path.join(OUT_DIR, "proof-sat.jpg");

const N_MEDIA_VARIANTS = 12;
const N_FILLER = 1150; // text-only posts: they drive the "~N posts" estimate
const COORD_TWEETS = [
  // [text-without-coord, lat, lng, telegramSource?]
  ["Artillery impact on a warehouse complex east of the rail junction.", 48.5871, 38.0292, null],
  ["Geolocated the strike from this morning's footage. Matched the treeline and the water tower.", 47.8412, 37.6021, "https://t.me/mil_footage_ua/48211"],
  ["Impact crater next to the grain silos, matched to the drone pass.", 47.0954, 37.5431, null],
  ["Position of the destroyed bridge section on the supply road.", 48.0121, 37.8024, null],
  ["Strike on a vehicle depot, matched rooftops and the road curve.", 48.9152, 38.4413, "https://t.me/conflict_obs/91224"],
  ["Placed the air defence activity seen last night. Compared against the intersection layout.", 46.6558, 32.6178, null],
  ["Smoke plume origin from the harbour footage.", 46.4825, 30.7233, null],
  ["Matched the damaged substation to satellite imagery.", 47.9105, 33.3918, null],
  ["Location of the trench line visible in the flyover clip.", 47.2431, 37.1893, null],
  ["Strike footage placed. The chimney pair and the rail spur line up.", 48.2891, 37.1782, "https://t.me/frontline_watch/33871"],
  ["Fuel storage fire, placed off the road geometry.", 48.7412, 37.5989, null],
  ["Geolocated the convoy ambush site from the dashcam clip.", 47.5623, 36.8341, null],
  ["Impact on the northern industrial zone, roofline match.", 48.4432, 37.9821, null],
  ["Placed the fortified position from the trench network shape.", 47.3319, 36.4412, "https://t.me/osint_daily_feed/77120"],
  ["Strike on the crossing point, matched both riverbanks.", 48.1187, 37.7413, null],
  ["Located the wreckage field from the morning clip.", 47.7789, 36.9932, null],
  ["Damaged radar site, placed via the access road fork.", 46.9921, 33.1187, null],
  ["Matched the checkpoint from the roadside footage.", 47.4471, 34.3312, null],
  ["Strike aftermath at the depot, crane and hangar match.", 48.6612, 38.1121, "https://t.me/mil_footage_ua/48544"],
  ["Placed the artillery position from counter-battery footage.", 48.3345, 38.2289, null],
  ["Geolocated the downed UAV crash site.", 47.1521, 37.6644, null],
  ["Impact next to the water treatment plant, matched the basin shapes.", 47.8834, 35.1189, null],
  ["Located the pontoon crossing from the overhead pass.", 48.0567, 38.3312, null],
  ["Strike on the command post building, corner balcony match.", 48.8123, 38.0034, "https://t.me/conflict_obs/91410"],
  ["Placed the mortar position from the smoke trail alignment.", 47.6612, 36.5523, null],
  ["Geolocated the burning vehicle column.", 48.2214, 37.4456, null],
  ["Matched the destroyed fuel truck to the road bend.", 47.9987, 36.7789, null],
  ["Impact site by the rail depot, placed via the switch tower.", 48.5123, 37.8891, null],
];

function pad(n, w) {
  return String(n).padStart(w, "0");
}

// Twitter created_at format: "Wed Nov 12 14:33:00 +0000 2025"
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function twitterDate(d) {
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate(), 2)} ` +
    `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)} ` +
    `+0000 ${d.getUTCFullYear()}`
  );
}

function ensureMediaCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (let i = 0; i < N_MEDIA_VARIANTS; i++) {
    const file = path.join(CACHE_DIR, `still-${i}.jpg`);
    if (fs.existsSync(file)) continue;
    // Dark, moody gradient stills with grain: read as low-light field footage
    // frames in a thumbnail, and each seed gives a distinct image.
    const c0 =["0x14161a", "0x1a1712", "0x101820", "0x1c1414"][i % 4];
    const c1 = ["0x4a3a26", "0x39424e", "0x50402c", "0x2e3a30"][(i + 1) % 4];
    execFileSync("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", `gradients=s=1280x720:c0=${c0}:c1=${c1}:n=2:seed=${100 + i * 7}`,
      "-vf", "noise=alls=12:allf=t,eq=contrast=1.05:brightness=-0.02",
      "-frames:v", "1",
      "-q:v", "4",
      file,
    ], { stdio: "ignore" });
  }
  // The "cross-referenced satellite imagery" proof still for the promote beat:
  // muted terrain gradient + measurement grid + a crosshair box.
  if (!fs.existsSync(PROOF_IMG)) {
    execFileSync("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "gradients=s=1280x720:c0=0x232b1e:c1=0x161c16:n=2:seed=42",
      "-vf",
      [
        "noise=alls=7:allf=t",
        "drawgrid=w=80:h=80:color=0x5a6a5a55:thickness=1",
        "drawbox=x=560:y=280:w=160:h=160:color=0xf97316@0.9:t=3",
        "drawbox=x=636:y=200:w=2:h=80:color=0xf97316@0.9:t=fill",
        "drawbox=x=636:y=440:w=2:h=80:color=0xf97316@0.9:t=fill",
        "drawbox=x=480:y=358:w=80:h=2:color=0xf97316@0.9:t=fill",
        "drawbox=x=720:y=358:w=80:h=2:color=0xf97316@0.9:t=fill",
      ].join(","),
      "-frames:v", "1",
      "-q:v", "4",
      PROOF_IMG,
    ], { stdio: "ignore" });
  }
}

function generate() {
  ensureMediaCache();
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE_DIR, "tweets_media"), { recursive: true });

  // Fresh id space per run → fresh detections on every recording.
  const runTag = String(Date.now()).slice(-9);
  let seq = 0;
  const mintId = () => `19${runTag}${pad(seq++, 4)}`;

  const entries = [];
  // Spread post dates over the last ~10 months, newest first not required
  // (stitch orders by created_at).
  const now = Date.UTC(2026, 6, 10, 12, 0, 0);
  const spanMs = 300 * 24 * 3600 * 1000;

  const addMedia = (id, variant) => {
    const basename = `Fv${runTag}${pad(variant, 2)}.jpg`;
    fs.copyFileSync(
      path.join(CACHE_DIR, `still-${variant % N_MEDIA_VARIANTS}.jpg`),
      path.join(STAGE_DIR, "tweets_media", `${id}-${basename}`)
    );
    return {
      type: "photo",
      id_str: `${id}9`,
      media_url_https: `https://pbs.twimg.com/media/${basename}`,
    };
  };

  const FOOTAGE_CAPTIONS = [
    "Footage circulating this morning.",
    "Clip shared by a local channel.",
    "New footage from today.",
    "Video posted a few hours ago.",
  ];
  COORD_TWEETS.forEach(([text, lat, lng, tg], i) => {
    const when = new Date(now - Math.floor((i / COORD_TWEETS.length) * spanMs));
    const coord = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (tg) {
      // Off-platform footage: the geoloc tweet links a Telegram post. The
      // analyst's own attachment stays annotation (proof), the link is the
      // declared source. These drafts have no source-media thumbnail, which
      // is the realistic shape for Telegram-sourced work.
      const id = mintId();
      entries.push({
        tweet: {
          id_str: id,
          created_at: twitterDate(when),
          full_text: `${text} ${coord}\nSource: ${tg}`,
          extended_entities: { media: [addMedia(id, i)] },
          entities: {
            urls: [{ url: tg, expanded_url: tg, display_url: tg.replace("https://", "") }],
          },
        },
      });
    } else {
      // The dominant real pattern: quote your own footage post, add the
      // coordinate. The quoted post's media becomes the draft's SOURCE media
      // (thumbnail on the queue card), its timestamp the source_posted_at.
      const footageId = mintId();
      const geolocId = mintId();
      const footageWhen = new Date(when.getTime() - 3 * 3600 * 1000);
      entries.push({
        tweet: {
          id_str: footageId,
          created_at: twitterDate(footageWhen),
          full_text: FOOTAGE_CAPTIONS[i % FOOTAGE_CAPTIONS.length],
          extended_entities: {
            media:
              i % 3 === 0
                ? [addMedia(footageId, i), addMedia(footageId, i + 5)]
                : [addMedia(footageId, i)],
          },
        },
      });
      entries.push({
        tweet: {
          id_str: geolocId,
          created_at: twitterDate(when),
          full_text: `${text} ${coord}`,
          quoted_status_id_str: footageId,
        },
      });
    }
  });

  const FILLER = [
    "Long day going through footage. More placements tomorrow.",
    "Thread on yesterday's strikes coming later.",
    "Cross-checking two clips that look like the same event.",
    "If you have a higher resolution version of this clip, send it over.",
    "Working through the backlog from the weekend.",
    "The light in that video puts it in the early morning, not midday.",
    "Comparing pre and post strike imagery now.",
    "That viral clip is from 2022, not from this week.",
  ];
  for (let i = 0; i < N_FILLER; i++) {
    const when = new Date(now - Math.floor(Math.random() * spanMs));
    entries.push({
      tweet: {
        id_str: mintId(),
        created_at: twitterDate(when),
        full_text: FILLER[i % FILLER.length],
      },
    });
  }

  fs.writeFileSync(
    path.join(STAGE_DIR, "tweets.js"),
    "window.YTD.tweets.part0 = " + JSON.stringify(entries, null, 2)
  );

  fs.rmSync(ZIP_PATH, { force: true });
  execFileSync("zip", ["-r", "-q", ZIP_PATH, "tweets.js", "tweets_media"], {
    cwd: STAGE_DIR,
  });
  const size = fs.statSync(ZIP_PATH).size;
  console.log(
    `✓ ${ZIP_PATH} (${(size / 1024 / 1024).toFixed(1)} MB, ` +
      `${entries.length} posts, ${COORD_TWEETS.length} coordinate posts)`
  );
  return { zipPath: ZIP_PATH, proofImagePath: PROOF_IMG, total: entries.length, coordCount: COORD_TWEETS.length };
}

if (require.main === module) generate();
module.exports = { generate, ensureMediaCache, ZIP_PATH, PROOF_IMG, CACHE_DIR };
