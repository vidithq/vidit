import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { BrowserChrome, CHROME_HEADER_HEIGHT } from "./components/BrowserChrome";
import { Caption } from "./components/Caption";
import { Intro } from "./components/Intro";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { MONTSERRAT } from "./fonts";
import { RECORDED } from "./clips-manifest";

// The Getting started walkthrough: the brand intro, one scene per beat of the
// six `/guide` sections, the closing card. `/guide` plays it at the top of the
// page, so it reads as a tour rather than as a promo.
//
// Unlike the promos it is CUT. A tour of six sections crosses a dozen pages,
// and the take reaches most of them by reload, so each scene is a window of a
// take between two of its marks (`from`, `to`), and `record-guide.js` stamps
// every opening mark after its page has settled. A scene dissolves in over the
// one before it. Two scenes of the same take share the same window geometry,
// so the outgoing one holds while the incoming one fades in and the chrome
// never dips; a scene that hands over to the other take, or to the closing
// card, fades out too, since the window changes size.
//
// The ground is flat `#0a0a0a`, the treatment `PromoCollections` settled on
// for a bright page filling most of the frame. The intro names no release: the
// guide outlives the release it was recorded on.
//
// Captions and the address bar hang off the takes' marks, so a re-record needs
// `node gen-clips-manifest.js` and nothing else. A scene whose take is not on
// this machine renders an empty browser window that names the missing file and
// runs for its `estimate`, with its captions spread evenly across it, so the
// composition still bundles, previews and renders before the first shoot.

const COMP_FPS = 60;
const CROSSFADE = 18;

// The browser body is what is left of a 1080-tall frame after the top margin,
// the chrome header and the caption band. Each take is recorded at that height
// and at its own aspect (see `DESKTOP` and `PHONE` in record-guide.js), so it
// plays at scale 1.
const CHROME_TOP = 14;
const CAPTION_BAND = 176;
const BODY_HEIGHT = 1080 - CHROME_TOP - CAPTION_BAND - CHROME_HEADER_HEIGHT;
const CAPTURES = {
  guide: { width: 1392, height: 830 },
  "guide-phone": { width: 600, height: 830 },
} as const;
type Take = keyof typeof CAPTURES;
const CAPTION_FONT_SIZE = 38;

const INTRO_FRAMES = 180; // 3.0s
const OUTRO_FRAMES = 156; // 2.6s
const INTRO_LEAD = 12;

type Scene = {
  take: Take;
  from: string;
  to: string;
  /** Seconds the scene runs while its take is missing. */
  estimate: number;
  eyebrow: string;
  cues: { at: string; title: string }[];
  urls: { at: string; url: string }[];
};

const SCENES: Scene[] = [
  {
    take: "guide",
    from: "layout",
    to: "layoutEnd",
    estimate: 9,
    eyebrow: "The layout",
    cues: [
      { at: "layout", title: "The rail on the left opens every part of Vidit" },
      { at: "railMap", title: "The map, requests, your feed and search" },
      { at: "railNotifications", title: "Your notifications and settings sit at the bottom" },
    ],
    urls: [{ at: "layout", url: "vidit.app/map" }],
  },
  {
    take: "guide-phone",
    from: "phone",
    to: "phoneEnd",
    estimate: 6,
    eyebrow: "The layout",
    cues: [
      { at: "phone", title: "On a phone, the rail folds into the button at the top left" },
      { at: "drawerOpen", title: "Tap it to open the rail as a drawer" },
    ],
    urls: [{ at: "phone", url: "vidit.app/map" }],
  },
  {
    take: "guide",
    from: "event",
    to: "eventEnd",
    estimate: 16,
    eyebrow: "Reading a geolocation",
    cues: [
      { at: "event", title: "Each geolocation has its own page, led by the source media" },
      { at: "eventCoords", title: "The coordinates, with the point on a map" },
      { at: "eventSource", title: "The source, and an archived copy in case the post disappears" },
      { at: "eventProof", title: "The proof shows how the place was found" },
      { at: "eventByline", title: "The byline names the geolocators" },
      { at: "eventVersions", title: "Every correction adds a version, and older versions stay readable" },
      { at: "eventApprovals", title: "Approvals show who checked this version" },
    ],
    urls: [{ at: "event", url: "vidit.app/events/…" }],
  },
  {
    take: "guide",
    from: "statuses",
    to: "statusesEnd",
    estimate: 8,
    eyebrow: "The three statuses",
    cues: [
      { at: "statuses", title: "Every event carries one of three statuses" },
      { at: "statusDetected", title: "Detected: read from your post, waiting for your review" },
      { at: "statusGeolocated", title: "Geolocated: a detection becomes one when you submit it" },
      { at: "statusRequested", title: "Requested: footage someone asks the community to place" },
    ],
    urls: [{ at: "statuses", url: "vidit.app/search?type=event&author=…" }],
  },
  {
    take: "guide",
    from: "import",
    to: "importEnd",
    estimate: 13,
    eyebrow: "Bringing your work in",
    cues: [
      { at: "import", title: "Three ways bring your geolocations in from X" },
      { at: "importArchive", title: "Upload your X archive to bring back everything at once" },
      { at: "importPaste", title: "Paste the link to one of your posts" },
      { at: "importBot", title: "Or tag @ViditBot under a post on X" },
      { at: "submitUrl", title: "Submit opens the form for a new geolocation or request" },
      { at: "submitXPost", title: "The pasted post and the archive upload start here too" },
    ],
    urls: [
      { at: "import", url: "vidit.app/import" },
      { at: "submitUrl", url: "vidit.app/submit" },
    ],
  },
  {
    take: "guide",
    from: "approve",
    to: "approveEnd",
    estimate: 3,
    eyebrow: "Working with others",
    cues: [{ at: "approve", title: "Approve a geolocation you checked" }],
    urls: [{ at: "approve", url: "vidit.app/events/…" }],
  },
  {
    take: "guide",
    from: "request",
    to: "requestEnd",
    estimate: 7,
    eyebrow: "Working with others",
    cues: [
      { at: "request", title: "Ask an analyst or an organization to approve yours" },
      { at: "editUrl", title: "Invite a co-geolocator to share the credit" },
    ],
    urls: [
      { at: "request", url: "vidit.app/events/…" },
      { at: "editUrl", url: "vidit.app/events/…/edit" },
    ],
  },
  {
    take: "guide",
    from: "organization",
    to: "organizationEnd",
    estimate: 5,
    eyebrow: "Working with others",
    cues: [
      { at: "organization", title: "An organization approves as one team" },
      { at: "orgApprovals", title: "Its page lists the members and the approvals given in its name" },
    ],
    urls: [{ at: "organization", url: "vidit.app/organizations/…" }],
  },
  {
    take: "guide",
    from: "follow",
    to: "feedEnd",
    estimate: 8,
    eyebrow: "Working with others",
    cues: [
      { at: "follow", title: "Follow the analysts whose work you rely on" },
      { at: "feedUrl", title: "Your feed shows what they publish" },
    ],
    urls: [
      { at: "follow", url: "vidit.app/profile/…" },
      { at: "feedUrl", url: "vidit.app/feed" },
    ],
  },
  {
    take: "guide",
    from: "profile",
    to: "profileEnd",
    estimate: 5,
    eyebrow: "Your settings",
    cues: [{ at: "profile", title: "Edit your profile on your own page" }],
    urls: [{ at: "profile", url: "vidit.app/profile/…" }],
  },
  {
    take: "guide",
    from: "settings",
    to: "settingsEnd",
    estimate: 6,
    eyebrow: "Your settings",
    cues: [
      { at: "settings", title: "Choose who can send you approval requests" },
      { at: "settingsMatrix", title: "Pick which kinds of notification also reach you by email or push" },
    ],
    urls: [{ at: "settings", url: "vidit.app/settings" }],
  },
];

// ── timeline ──────────────────────────────────────────────────────────────

type Placed = Scene & {
  src: string | null;
  startFrom: number;
  start: number;
  frames: number;
  cueFrames: number[];
  urlSecs: number[];
};

const place = (scene: Scene, start: number): Placed => {
  const clip = RECORDED[scene.take];
  const from = clip?.marks[scene.from];
  const to = clip?.marks[scene.to];
  const recorded = clip !== undefined && from !== undefined && to !== undefined && to > from;
  const fromSec = recorded ? from : 0;
  const length = recorded ? to - from : scene.estimate;
  const offset = (at: string, i: number, n: number) => {
    const m = recorded ? clip.marks[at] : undefined;
    return m !== undefined ? m - fromSec : (length * i) / n;
  };
  return {
    ...scene,
    src: recorded ? clip.src : null,
    startFrom: Math.round(fromSec * COMP_FPS),
    start,
    frames: Math.round(length * COMP_FPS),
    cueFrames: scene.cues.map((c, i, all) => Math.round(offset(c.at, i, all.length) * COMP_FPS)),
    urlSecs: scene.urls.map((u, i, all) => offset(u.at, i, all.length)),
  };
};

const PLACED: Placed[] = [];
for (const scene of SCENES) {
  const prev = PLACED[PLACED.length - 1];
  const start = prev ? prev.start + prev.frames - CROSSFADE : INTRO_FRAMES - INTRO_LEAD - CROSSFADE;
  PLACED.push(place(scene, start));
}
const last = PLACED[PLACED.length - 1];
const OUTRO_START = last.start + last.frames - CROSSFADE;
export const GUIDE_WALKTHROUGH_DURATION = OUTRO_START + OUTRO_FRAMES;

// Each caption runs until the next one starts; the last clears before the
// closing card comes in. Two marks stamped in the same frame leave the first
// caption no time, so it is dropped rather than flashed.
const CAPTIONS = PLACED.flatMap((s) =>
  s.cues.map((c, i) => ({ eyebrow: s.eyebrow, title: c.title, from: s.start + s.cueFrames[i] }))
)
  .map((c, i, all) => ({ ...c, to: all[i + 1]?.from ?? OUTRO_START }))
  .filter((c) => c.to > c.from);

// ── stage ─────────────────────────────────────────────────────────────────

const MissingTake: React.FC<{ take: Take }> = ({ take }) => (
  <AbsoluteFill
    style={{
      background: "#0a0a0a",
      justifyContent: "center",
      alignItems: "center",
      textAlign: "center",
      fontFamily: MONTSERRAT,
      color: "#a3a3a3",
      fontSize: 22,
      lineHeight: 1.5,
      padding: 40,
    }}
  >
    <div>
      <div style={{ color: "#fafafa", fontWeight: 600 }}>public/clips/{take}.mp4 is not recorded</div>
      <div>Run npm run record:guide, then render again.</div>
    </div>
  </AbsoluteFill>
);

const Stage: React.FC<{ scene: Placed; fadeOut: boolean }> = ({ scene, fadeOut }) => {
  const frame = useCurrentFrame();
  const sec = frame / COMP_FPS;
  const url = scene.urls.reduce((cur, u, i) => (sec >= scene.urlSecs[i] ? u.url : cur), scene.urls[0].url);
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const opacity =
    interpolate(frame, [0, CROSSFADE], [0, 1], clamp) *
    (fadeOut ? interpolate(frame, [scene.frames - CROSSFADE, scene.frames], [1, 0], clamp) : 1);
  const capture = CAPTURES[scene.take];
  const width = Math.round((BODY_HEIGHT * capture.width) / capture.height);
  const height = BODY_HEIGHT + CHROME_HEADER_HEIGHT;

  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: Math.round((1920 - width) / 2), top: CHROME_TOP }}>
        {scene.src ? (
          <VideoChrome src={scene.src} url={url} width={width} height={height} startFrom={scene.startFrom} />
        ) : (
          <BrowserChrome url={url} width={width} height={height}>
            <MissingTake take={scene.take} />
          </BrowserChrome>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const GuideWalkthrough: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
    <Sequence from={-INTRO_LEAD} durationInFrames={INTRO_FRAMES}>
      <Intro durationInFrames={INTRO_FRAMES} flat />
    </Sequence>

    {PLACED.map((scene, i) => (
      <Sequence key={`${scene.take}:${scene.from}`} from={scene.start} durationInFrames={scene.frames}>
        <Stage scene={scene} fadeOut={PLACED[i + 1]?.take !== scene.take} />
      </Sequence>
    ))}

    {CAPTIONS.map((c) => (
      <Sequence key={`${c.from}:${c.title}`} from={c.from} durationInFrames={c.to - c.from}>
        <Caption
          eyebrow={c.eyebrow}
          title={c.title}
          fontSize={CAPTION_FONT_SIZE}
          durationInFrames={c.to - c.from}
        />
      </Sequence>
    ))}

    <Sequence from={OUTRO_START} durationInFrames={OUTRO_FRAMES}>
      <OutroV04 durationInFrames={OUTRO_FRAMES} flat />
    </Sequence>
  </AbsoluteFill>
);
