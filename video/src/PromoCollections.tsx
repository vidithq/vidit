import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Caption } from "./components/Caption";
import { Intro } from "./components/Intro";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { RECORDED } from "./clips-manifest";
import { RELEASE } from "./build-version";

// The collections promo: the brand intro, then ONE unbroken take of a
// collection being read and then added to, then the closing card.
//
// The middle is a single continuous window of collections.mp4. There is no cut
// anywhere in it: the page travels by scrolling, the map travels by flying,
// and every page change is an in-page router push the take performs on camera.
// The only two transitions in the whole video are the crossfades into and out
// of the recorded part, where the world genuinely changes.
//
// That is why this file carries no beat or window machinery, the shape
// `PromoV05` settled on: it places three scenes and hangs captions off the
// take's own marks, so a re-record needs `node gen-clips-manifest.js` and
// nothing else. Nothing is hand-timed against wall-clock seconds.
//
// This promo stands on a FLAT ground: `#0a0a0a` and nothing else, where the
// other promos use the shared `<Background>` and its two radial blooms. The
// take is a bright product page filling most of the frame, and a bloom behind
// it reads as a smear around the window rather than as depth. `<Intro>` and
// `<OutroV04>` paint no ground of their own, only centred type on a
// transparent fill, and both take `flat` here, which drops the orange bloom
// behind the wordmark's V: that bloom is the one radial either of them paints,
// and on this ground it is the one thing that would break it.

const COMP_FPS = 60;
// Long enough to read as a dissolve rather than a cut.
const CROSSFADE = 18;

const CLIP = "collections";

// Stage layout, and the capture size it dictates.
//
// The browser body is what is left of a 1080-tall frame after the chrome
// header, the top margin and the caption band: 830 px, and 1392 wide at the
// take's aspect. The take is RECORDED at exactly those CSS px (see
// `VIEWPORT` in record-collections.js), so the render draws the picture at
// scale 1 instead of magnifying a smaller window into it, which is what read
// soft. At DPR 2 the encode holds 2784x1660 device px behind those 1392x830,
// so the only resampling left is a 2:1 downscale.
//
// The pair is a fixed point: BODY_WIDTH below returns 1392 for a 1392x830
// capture, so the geometry and the viewport agree without either being tuned
// to the other. Move the caption band or the chrome header and re-derive both.
//
// The caption band is wider than the portfolio promo's for the same reason its
// type is a step smaller: the longest line here runs to two lines at 38px, and
// the band is what keeps the second line off the browser chrome above it.
//
// The body carries the take's aspect ratio exactly, so `objectFit: cover` has
// nothing to crop.
const CAPTURE = { width: 1392, height: 830 };
const CHROME_HEADER = 60; // must match BrowserChrome.CHROME_HEADER_HEIGHT
const CHROME_TOP = 14;
const CAPTION_BAND = 176;
const BODY_HEIGHT = 1080 - CHROME_TOP - CAPTION_BAND - CHROME_HEADER;
const BODY_WIDTH = Math.round((BODY_HEIGHT * CAPTURE.width) / CAPTURE.height);
const CHROME_WIDTH = BODY_WIDTH;
const CHROME_HEIGHT = BODY_HEIGHT + CHROME_HEADER;
const CHROME_LEFT = Math.round((1920 - CHROME_WIDTH) / 2);
const CAPTION_FONT_SIZE = 38;

const INTRO_FRAMES = 240; // 4.0s
const OUTRO_FRAMES = 156; // 2.6s
// The intro starts slightly BEFORE the composition does, so the wordmark has
// already sprung in by frame 0. Frame 0 is the poster frame a tweet shows
// before anyone presses play, and the spring's own frame 0 is transparent.
const INTRO_LEAD = 12;

const clip = RECORDED[CLIP];
const mark = (key: string, fallback: number) => clip?.marks?.[key] ?? fallback;

// The recorded window: the whole take from its first frame, stopping shortly
// after the closing hold on the narrowed shelf. Trimming the tail is not a
// cut, it is where the shot ends.
const TAKE_FROM = mark("shelf", 0);
const TAKE_TO = Math.min(
  clip?.durationSec ?? 0,
  mark("queryResult", 42) + 2.2 + 0.5 // the closing hold, then a beat of air
);
const TAKE_FRAMES = Math.round((TAKE_TO - TAKE_FROM) * COMP_FPS);

// ── captions, anchored to the take's marks ────────────────────────────────
//
// `at` is a mark name: the caption appears when the take reaches it and runs
// until the next one. Captions changing over an unbroken take is the one kind
// of change the shot allows.

type CaptionCue = { at: number; eyebrow: string; title: string };

const CUES: CaptionCue[] = [
  {
    // The profile's shelf, from the scroll onto it through the hover.
    at: mark("shelf", 0),
    eyebrow: "The shelf",
    title: "Collections",
  },
  {
    // On the route change rather than after the page settles, so the line is
    // already read by the time the Description card arrives under it.
    at: mark("collectionUrl", 10.5),
    eyebrow: "One collection",
    title: "Every geolocation of one operation, in the order it happened",
  },
  {
    at: mark("step", 15),
    eyebrow: "The player",
    title: "Step through them on the map",
  },
  {
    // One line over the whole write beat, from the route change into the edit
    // page to the save's own return: the two cards, the query typed into the
    // picker, the row added, the save, and the collection coming back a
    // geolocation longer. The return is what proves the line, so it sits under
    // it rather than under a caption of its own.
    at: mark("editUrl", 22),
    eyebrow: "The edit page",
    title: "Add events with a search",
  },
  {
    // `profileUrl`, not `showMore` or `searchUrl`: the claim is about an
    // analyst's shelf, and the profile is where the shelf is first on screen.
    // It carries through the `Show more` click into the search page, which is
    // the same shelf whole.
    at: mark("profileUrl", 36),
    eyebrow: "The whole shelf",
    title: "Every collection an analyst publishes",
  },
  {
    at: mark("query", 42),
    eyebrow: "Search",
    title: "Search reaches collections too",
  },
];

// The address bar follows the take's real navigation, so the faked chrome
// never claims a page the recording is not on. Every mark below is stamped the
// instant that route actually changed, `savedUrl` included: the save returns
// to the collection by a router push, which is a page change like any other.
const URL_CUES: { at: number; url: string }[] = [
  { at: mark("shelf", 0), url: "vidit.app/profile/MPGeoint" },
  { at: mark("collectionUrl", 9), url: "vidit.app/collections/…" },
  { at: mark("editUrl", 22), url: "vidit.app/collections/…/edit" },
  { at: mark("savedUrl", 32), url: "vidit.app/collections/…" },
  { at: mark("profileUrl", 36), url: "vidit.app/profile/MPGeoint" },
  {
    at: mark("searchUrl", 39),
    url: "vidit.app/search?type=collection&author=MPGeoint",
  },
];

const pickAt = <T extends { at: number }>(cues: T[], sec: number): T =>
  cues.reduce((cur, c) => (sec >= c.at - TAKE_FROM ? c : cur), cues[0]);

// ── timeline ──────────────────────────────────────────────────────────────

const TAKE_START = INTRO_FRAMES - INTRO_LEAD - CROSSFADE;
const OUTRO_START = TAKE_START + TAKE_FRAMES - CROSSFADE;
export const PROMO_COLLECTIONS_DURATION = OUTRO_START + OUTRO_FRAMES;

const TakeStage: React.FC = () => {
  const frame = useCurrentFrame();
  const sec = frame / COMP_FPS;
  const url = pickAt(URL_CUES, sec).url;
  const opacity =
    interpolate(frame, [0, CROSSFADE], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [TAKE_FRAMES - CROSSFADE, TAKE_FRAMES], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: "absolute",
          left: CHROME_LEFT,
          top: CHROME_TOP,
          width: CHROME_WIDTH,
          height: CHROME_HEIGHT,
        }}
      >
        <VideoChrome
          src={clip.src}
          url={url}
          width={CHROME_WIDTH}
          height={CHROME_HEIGHT}
          // `startFrom` counts frames at the COMPOSITION fps (Remotion maps
          // them to source seconds internally), so the offset converts with
          // COMP_FPS.
          startFrom={Math.round(TAKE_FROM * COMP_FPS)}
        />
      </div>
    </AbsoluteFill>
  );
};

export const PromoCollections: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <Sequence from={-INTRO_LEAD} durationInFrames={INTRO_FRAMES}>
        <Intro durationInFrames={INTRO_FRAMES} release={RELEASE} flat />
      </Sequence>

      <Sequence from={TAKE_START} durationInFrames={TAKE_FRAMES}>
        <TakeStage />
      </Sequence>

      {CUES.map((cue, i) => {
        const from = Math.round((cue.at - TAKE_FROM) * COMP_FPS);
        const next = CUES[i + 1];
        const to = next
          ? Math.round((next.at - TAKE_FROM) * COMP_FPS)
          : // The last caption clears before the take crossfades out, so it
            // never co-renders with the closing card.
            TAKE_FRAMES - CROSSFADE;
        const frames = to - from;
        if (frames <= 0) return null;
        return (
          <Sequence
            key={cue.title}
            from={TAKE_START + from}
            durationInFrames={frames}
          >
            <Caption
              eyebrow={cue.eyebrow}
              title={cue.title}
              fontSize={CAPTION_FONT_SIZE}
              durationInFrames={frames}
            />
          </Sequence>
        );
      })}

      <Sequence from={OUTRO_START} durationInFrames={OUTRO_FRAMES}>
        <OutroV04 durationInFrames={OUTRO_FRAMES} flat />
      </Sequence>
    </AbsoluteFill>
  );
};
