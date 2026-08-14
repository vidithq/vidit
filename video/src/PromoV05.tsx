import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Background } from "./components/Background";
import { Caption } from "./components/Caption";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { RECORDED } from "./clips-manifest";

// The v0.5 promo A, "the portfolio": 22 seconds, no voice, captions on
// screen. Five beats windowed out of ONE continuous logged-out take
// (portfolio.mp4: profile identity → recent submissions → coverage map →
// an event's detail → the general map), then the closing card.
//
// Beat 1 is deliberately motionless: the first frame is the thumbnail a
// tweet shows before anyone presses play, so it has to hold still and it has
// to be a face, which here is the analyst's identity block.
//
// Beats butt-join as jump cuts inside the same session, exactly as PromoV04
// does. The one navigation on camera (the submission click) is split into
// two windows so the cut rides the click itself rather than the dev server's
// route compile.
//
// Every window is anchored to a mark from src/clips-manifest.ts (generated
// from the take), so a re-record needs `node gen-clips-manifest.js` and
// nothing else; no timing here is hand-fitted to wall-clock seconds.

const COMP_FPS = 60;
const FADE = 12;

// Stage layout: identical to PromoV04 so the two promos cut together. The
// recording is letterboxed high in the frame and the band below it is
// reserved for captions.
const CHROME_WIDTH = 1370;
const CHROME_HEIGHT = 830;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 24;
const CAPTION_FONT_SIZE = 42;

const CLIP = "portfolio";
const PROFILE_URL = "vidit.app/profile/MPGeoint";

type Window = { from: number; seconds: number; url: string };

const mark = (key: string, fallback: number) =>
  RECORDED[CLIP]?.marks?.[key] ?? fallback;

// One window of the take: it starts `lead` seconds before `markKey` and runs
// for exactly `seconds`, so each beat's frame count is fixed by the
// storyboard rather than by how long the recorded gesture happened to take.
function win(markKey: string, fallback: number, lead: number, seconds: number, url: string): Window {
  const from = Math.max(0, mark(markKey, fallback) - lead);
  const cap = RECORDED[CLIP]?.durationSec ?? from + seconds;
  return { from, seconds: Math.max(0.1, Math.min(seconds, cap - from)), url };
}

const winFrames = (w: Window) => Math.round(w.seconds * COMP_FPS);

// ── the storyboard ────────────────────────────────────────────────────────

type Beat = {
  name: string;
  windows: Window[];
  caption: { eyebrow: string; title: string };
  fadeIn?: boolean;
  fadeOut?: boolean;
};

const BEATS: Beat[] = [
  {
    // 0:00–0:03. Still. Avatar, handle, bio, counters, no cursor: the take
    // never moves the mouse before the click beat, and the DOM cursor
    // overlay only paints once it has.
    name: "identity",
    fadeIn: true,
    windows: [win("identity", 0, 0, 3.0, PROFILE_URL)],
    caption: { eyebrow: "The profile", title: "Your work, on one page." },
  },
  {
    // 0:03–0:07. The eased scroll down to Recent submissions, then the list
    // of real footage thumbnails holds.
    name: "submissions",
    windows: [win("submissions", 4.57, 0.3, 4.0, PROFILE_URL)],
    caption: {
      eyebrow: "Recent submissions",
      title: "Every event you documented.",
    },
  },
  {
    // 0:07–0:11. The coverage map, already fitted to the analyst's own
    // points on mount, then the camera walks into the densest worked area.
    name: "coverage",
    windows: [win("coverageHold", 11.71, 0.2, 4.0, PROFILE_URL)],
    caption: { eyebrow: "Coverage", title: "The ground you covered." },
  },
  {
    // 0:11–0:16. The click on a submission, then the event: source media,
    // the point map, the coordinates, the source row with its archived-copy
    // glyph, and the written proof.
    name: "event",
    windows: [
      win("cardClicked", 20.29, 0.75, 0.9, PROFILE_URL),
      // The take picks the event at record time (first recent submission
      // that carries source media, coordinates and a written proof), so the
      // faked address bar stays at the route rather than naming an id that
      // the next re-record would invalidate.
      win("eventOpen", 21.03, 0.05, 4.1, "vidit.app/events/…"),
    ],
    caption: {
      eyebrow: "One event",
      title: "The source, the coordinates, and the proof behind it.",
    },
  },
  {
    // 0:16–0:20. Back to the general map, pulling back so the analyst's
    // points sit among everyone else's.
    name: "archive",
    fadeOut: true,
    windows: [win("mapOpen", 30.66, 0.2, 4.0, "vidit.app/map")],
    caption: {
      eyebrow: "The archive",
      title: "One archive, open to read without an account.",
    },
  },
];

const OUTRO_FRAMES = 132; // 2.2s, overlapping the last beat's fade by FADE

// ── timeline assembly ─────────────────────────────────────────────────────

type PlacedBeat = Beat & { start: number; frames: number };

let _cursor = 0;
const PLACED: PlacedBeat[] = BEATS.map((beat) => {
  const frames = beat.windows.reduce((acc, w) => acc + winFrames(w), 0);
  const start = _cursor;
  _cursor = start + frames;
  return { ...beat, start, frames };
});
const OUTRO_START = _cursor - FADE;
export const PROMO_V05_DURATION = OUTRO_START + OUTRO_FRAMES;

const SceneFade: React.FC<{
  duration: number;
  fadeIn: boolean;
  fadeOut: boolean;
  children: React.ReactNode;
}> = ({ duration, fadeIn, fadeOut, children }) => {
  const f = useCurrentFrame();
  const clamp = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  let opacity = 1;
  if (fadeIn) opacity *= interpolate(f, [0, FADE], [0, 1], clamp);
  if (fadeOut)
    opacity *= interpolate(f, [duration - FADE, duration], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const RecordedWindow: React.FC<{ w: Window }> = ({ w }) => {
  const meta = RECORDED[CLIP];
  return (
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
        src={meta.src}
        url={w.url}
        width={CHROME_WIDTH}
        height={CHROME_HEIGHT}
        // `startFrom` counts frames at the COMPOSITION fps (Remotion maps
        // them to source seconds internally), so the window offset converts
        // with COMP_FPS.
        startFrom={Math.round(w.from * COMP_FPS)}
      />
    </div>
  );
};

export const PromoV05: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      {PLACED.map((beat) => {
        const segments: React.ReactNode[] = [];
        let offset = 0;
        for (const [i, w] of beat.windows.entries()) {
          segments.push(
            <Sequence key={i} from={offset} durationInFrames={winFrames(w)}>
              <RecordedWindow w={w} />
            </Sequence>
          );
          offset += winFrames(w);
        }
        return (
          <Sequence
            key={beat.name}
            from={beat.start}
            durationInFrames={beat.frames}
          >
            <SceneFade
              duration={beat.frames}
              fadeIn={!!beat.fadeIn}
              fadeOut={!!beat.fadeOut}
            >
              {segments}
              <Caption
                eyebrow={beat.caption.eyebrow}
                title={beat.caption.title}
                fontSize={CAPTION_FONT_SIZE}
                // End the caption's own fade before a fading beat's video
                // fade, so two captions never co-render.
                durationInFrames={beat.frames - (beat.fadeOut ? FADE : 0)}
              />
            </SceneFade>
          </Sequence>
        );
      })}

      <Sequence from={OUTRO_START} durationInFrames={OUTRO_FRAMES}>
        <OutroV04 durationInFrames={OUTRO_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  );
};
