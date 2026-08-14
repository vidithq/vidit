import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Background } from "./components/Background";
import { Caption } from "./components/Caption";
import { Intro } from "./components/Intro";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { RECORDED } from "./clips-manifest";
import { RELEASE } from "./build-version";

// The v0.5 promo A, "the portfolio": the brand intro, then ONE unbroken take
// of an analyst's public profile, then the closing card.
//
// The middle is a single continuous window of portfolio.mp4. There is no cut
// anywhere in it: the page travels by scrolling, the camera travels by easing,
// and both page changes are in-page router pushes the take performs on camera.
// The only two transitions in the whole video are the crossfades into and out
// of the recorded part, where the world genuinely changes.
//
// That is why this file has no beat/window machinery. All it does is place
// three scenes and hang captions off the take's own marks, so a re-record
// needs `node gen-clips-manifest.js` and nothing else. Nothing is hand-timed
// against wall-clock seconds.
//
// Beat 1 is deliberately motionless and cursor-free: the first frame is the
// thumbnail a tweet shows before anyone presses play.

const COMP_FPS = 60;
// Long enough to read as a dissolve rather than a cut.
const CROSSFADE = 18;

const CLIP = "portfolio";

// Stage layout, sized so the PRODUCT fills the frame rather than floating in
// dark margins. Two numbers decide how big the page reads on a phone:
//
//   on-screen column width = BODY_HEIGHT x (page column width / capture height)
//
// The page's content column caps at 848 CSS px whatever the window width, so
// widening the capture only adds gutters. What enlarges the product is a
// SHORT capture (the take records 1040x560) and a tall body, which is why the
// caption band and the top margin are trimmed to what the type actually
// needs. The result magnifies the capture 1.56x instead of shrinking it to
// 0.92x, and the window covers 85% of the frame width instead of 61%.
//
// The body carries the take's aspect ratio exactly, so `objectFit: cover` has
// nothing to crop. Change the capture viewport in record-v05.js and these
// move with it.
const CAPTURE = { width: 1040, height: 560 };
const CHROME_HEADER = 60; // must match BrowserChrome.CHROME_HEADER_HEIGHT
const CHROME_TOP = 14;
const CAPTION_BAND = 132;
const BODY_HEIGHT = 1080 - CHROME_TOP - CAPTION_BAND - CHROME_HEADER;
const BODY_WIDTH = Math.round((BODY_HEIGHT * CAPTURE.width) / CAPTURE.height);
const CHROME_WIDTH = BODY_WIDTH;
const CHROME_HEIGHT = BODY_HEIGHT + CHROME_HEADER;
const CHROME_LEFT = Math.round((1920 - CHROME_WIDTH) / 2);
const CAPTION_FONT_SIZE = 40;

const INTRO_FRAMES = 240; // 4.0s
const OUTRO_FRAMES = 156; // 2.6s
// The intro starts slightly BEFORE the composition does, so the wordmark has
// already sprung in by frame 0. Frame 0 is the poster frame a tweet shows
// before anyone presses play, and the spring's own frame 0 is transparent.
const INTRO_LEAD = 12;

const clip = RECORDED[CLIP];
const mark = (key: string, fallback: number) => clip?.marks?.[key] ?? fallback;

// The recorded window: the whole take from the first still frame, stopping
// shortly after the closing camera ease settles. Trimming the tail is not a
// cut, it is where the shot ends.
const TAKE_FROM = mark("identity", 0);
const TAKE_TO = Math.min(
  clip?.durationSec ?? 0,
  mark("mapOpen", 19.85) + 2.1 + 0.6 // the pull-back ease, then a short hold
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
    at: mark("identity", 0),
    eyebrow: "The profile",
    title: "Your work, on one page.",
  },
  {
    // The travel down: linked accounts pass by, the counters and the Insights
    // card (47 geolocated, 440 detected, 1745 media) land.
    at: mark("work", 2.86),
    eyebrow: "The record",
    title: "Every event you documented.",
  },
  {
    at: mark("coverage", 6.13),
    eyebrow: "Coverage",
    title: "The ground you covered.",
  },
  {
    // Slightly ahead of the click, so the line is already read by the time
    // the event's source row arrives.
    at: mark("submissions", 8.83) + 1.4,
    eyebrow: "One event",
    title: "The source, and a copy that outlives it.",
  },
  {
    at: mark("mapNav", 17.36),
    eyebrow: "The archive",
    title: "One archive, open to read without an account.",
  },
];

// The address bar follows the take's real navigation, so the faked chrome
// never claims a page the recording is not on.
// `eventUrl` and `mapUrl` are stamped the instant each route actually
// changed, so the bar never names a page ahead of the picture.
const URL_CUES: { at: number; url: string }[] = [
  { at: mark("identity", 0), url: "vidit.app/profile/MPGeoint" },
  { at: mark("eventUrl", 12.51), url: "vidit.app/events/…" },
  { at: mark("mapUrl", 18.25), url: "vidit.app/map" },
];

const pickAt = <T extends { at: number }>(cues: T[], sec: number): T =>
  cues.reduce((cur, c) => (sec >= c.at - TAKE_FROM ? c : cur), cues[0]);

// ── timeline ──────────────────────────────────────────────────────────────

const TAKE_START = INTRO_FRAMES - INTRO_LEAD - CROSSFADE;
const OUTRO_START = TAKE_START + TAKE_FRAMES - CROSSFADE;
export const PROMO_V05_DURATION = OUTRO_START + OUTRO_FRAMES;

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

export const PromoV05: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      <Sequence from={-INTRO_LEAD} durationInFrames={INTRO_FRAMES}>
        <Intro durationInFrames={INTRO_FRAMES} release={RELEASE} />
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
        <OutroV04 durationInFrames={OUTRO_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  );
};
