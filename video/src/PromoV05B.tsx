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

// The v0.5 promo B, "import and review": the brand intro, then about 31
// seconds windowed out of ONE continuous signed-in take (import-review.mp4:
// the bulk-import panel, the archive picker, the progress steps, the
// detections queue, one draft reviewed and submitted, the map), then the
// closing card.
//
// Two things separate this comp from PromoV05:
//
//   1. It opens on the brand card rather than on the product, because the
//      first frame is the thumbnail a tweet shows before anyone presses play
//      and this take opens mid-form.
//   2. Beats DISSOLVE into each other rather than butt-joining. The take
//      walks one continuous session, so a hard cut between two frames of the
//      same session reads as a glitch rather than as an edit; a short mix
//      carries the eye across.
//
// Windows inside a beat still butt-join: they are contiguous stretches of the
// same take, so the join is invisible.
//
// Every window is anchored to a mark from src/clips-manifest.ts (generated
// from the take), so a re-record needs `node gen-clips-manifest.js` and
// nothing else; no timing here is hand-fitted to wall-clock seconds.

const COMP_FPS = 60;

// The dissolve between two beats, and the intro's overlap into the first one.
const CROSS = 14;

// Stage layout: identical to PromoV04 and PromoV05 so the promos cut together.
const CHROME_WIDTH = 1370;
const CHROME_HEIGHT = 830;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 24;
const CAPTION_FONT_SIZE = 40;

const CLIP = "import-review";

const SUBMIT_URL = "vidit.app/submit";
const QUEUE_URL = "vidit.app/profile/MPGeoint/detections";
// The take picks the draft it reviews at record time (the first row on the
// queue's Ready filter that clears the submit floor), so the faked address bar
// stays at the route rather than naming an id the next re-record invalidates.
const REVIEW_URL = "vidit.app/events/…/edit?queue=1";
const MAP_URL = "vidit.app/map";

type Window = { from: number; seconds: number; url: string };

const mark = (key: string, fallback: number) =>
  RECORDED[CLIP]?.marks?.[key] ?? fallback;

// One window of the take: it starts `lead` seconds before `markKey` and runs
// for exactly `seconds`, so each beat's frame count is fixed by the
// storyboard rather than by how long the recorded gesture happened to take.
function win(
  markKey: string,
  fallback: number,
  lead: number,
  seconds: number,
  url: string
): Window {
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
};

const BEATS: Beat[] = [
  {
    // The panel, the picker opening on the analyst's own export, and the
    // staged file. The dialog row and the staged card both read the real
    // file name and byte size, so what the frame names is what is imported.
    name: "import",
    windows: [
      win("panel", 0, 0, 2.0, SUBMIT_URL),
      win("finderOpen", 5.14, 0.6, 2.4, SUBMIT_URL),
      win("filePicked", 11.16, 0.4, 1.4, SUBMIT_URL),
    ],
    caption: {
      eyebrow: "Bulk import",
      title: "Start from the export X already gives you.",
    },
  },
  {
    // The progress steps. The caption is the product's own sentence, held on
    // the frame that carries it: this is the objection every analyst raises
    // when asked for their archive, so it gets the longest hold in the film.
    name: "privacy",
    windows: [win("privacyHold", 15.31, 0.3, 4.6, SUBMIT_URL)],
    caption: {
      eyebrow: "Before the upload, in your browser",
      title: "DMs, messages and account data never leave your device.",
    },
  },
  {
    // The finished run. This instance already holds every detection in the
    // export, so the outcome line reads "Everything in that archive is
    // already up to date". That is the v0.5.2 upsert seen from the outside,
    // and the caption says exactly that rather than dressing it as a haul.
    name: "idempotent",
    windows: [win("importDone", 21.82, 0.3, 2.4, SUBMIT_URL)],
    caption: {
      eyebrow: "Import it again tomorrow",
      title: "It recognises the detections it already made.",
    },
  },
  {
    // The queue on All, where the badges disagree with each other, then the
    // readiness filter narrowing it. The counts beside the filter are the
    // server's, over the whole queue rather than the page.
    name: "queue",
    windows: [
      win("queueOpen", 24.99, 0.2, 2.6, QUEUE_URL),
      win("filterReady", 27.6, 0.2, 2.4, QUEUE_URL),
    ],
    caption: {
      eyebrow: "The queue",
      title: "Every machine detection, and what each one still needs.",
    },
  },
  {
    // One draft opened into the review pass: the position in the queue, the
    // footage, the coordinates and the source, then the classification the
    // pass exists to supply.
    name: "review",
    windows: [
      win("draftOpen", 34.87, 0.2, 2.2, REVIEW_URL),
      win("draftScroll", 36.87, 0, 2.0, REVIEW_URL),
      win("tagFill", 40.94, 0.2, 2.4, REVIEW_URL),
    ],
    caption: {
      eyebrow: "The review pass",
      title: "One form: the footage, the coordinates, the classification.",
    },
  },
  {
    // The proof settling into frame, then both clicks. The window runs long
    // enough to carry the arm AND the confirm: submitting takes two clicks,
    // and a cut that hid the second would sell a faster product than this one.
    name: "submit",
    windows: [
      win("submitClick", 50.55, 1.25, 3.3, REVIEW_URL),
      win("nextDraft", 52.68, 0, 2.0, REVIEW_URL),
    ],
    caption: {
      eyebrow: "Submit",
      title: "Two clicks to freeze it, and the next detection opens itself.",
    },
  },
  {
    name: "map",
    windows: [win("mapEase", 60.69, 1.2, 3.2, MAP_URL)],
    caption: {
      eyebrow: "The map",
      title: "The work, gathered on one map.",
    },
  },
];

const INTRO_FRAMES = 144; // 2.4s, the last CROSS of it mixing into beat 1
const OUTRO_FRAMES = 132; // 2.2s, overlapping the last beat by CROSS

// ── timeline assembly ─────────────────────────────────────────────────────

type PlacedBeat = Beat & { start: number; frames: number };

let _cursor = INTRO_FRAMES - CROSS;
const PLACED: PlacedBeat[] = BEATS.map((beat) => {
  const frames = beat.windows.reduce((acc, w) => acc + winFrames(w), 0);
  const start = _cursor;
  // The next beat starts CROSS frames early and dissolves over this one's
  // tail, so each beat costs its own frames minus one dissolve.
  _cursor = start + frames - CROSS;
  return { ...beat, start, frames };
});
const LAST = PLACED[PLACED.length - 1];
const OUTRO_START = LAST.start + LAST.frames - CROSS;
export const PROMO_V05B_DURATION = OUTRO_START + OUTRO_FRAMES;

// Every beat but the first mixes in over its own first CROSS frames. The beat
// underneath is still painting its last CROSS frames, so the pair reads as a
// dissolve without either one having to fade to black.
// The last beat also mixes OUT, under the closing card: the card carries no
// ground of its own, so without that the wordmark would rise over live video.
const BeatMix: React.FC<{
  mixIn: boolean;
  mixOut: boolean;
  duration: number;
  children: React.ReactNode;
}> = ({ mixIn, mixOut, duration, children }) => {
  const f = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  let opacity = 1;
  if (mixIn) opacity *= interpolate(f, [0, CROSS], [0, 1], clamp);
  if (mixOut) opacity *= interpolate(f, [duration - CROSS, duration], [1, 0], clamp);
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

export const PromoV05B: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      <Sequence durationInFrames={INTRO_FRAMES}>
        <Intro durationInFrames={INTRO_FRAMES} release={RELEASE} />
      </Sequence>

      {PLACED.map((beat, beatIndex) => {
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
            <BeatMix
              mixIn={beatIndex > 0}
              mixOut={beatIndex === PLACED.length - 1}
              duration={beat.frames}
            >
              {segments}
              <Caption
                eyebrow={beat.caption.eyebrow}
                title={beat.caption.title}
                fontSize={CAPTION_FONT_SIZE}
                // End the caption before the next beat starts mixing in, so
                // two captions never co-render across a dissolve.
                durationInFrames={beat.frames - CROSS}
              />
            </BeatMix>
          </Sequence>
        );
      })}

      <Sequence from={OUTRO_START} durationInFrames={OUTRO_FRAMES}>
        <OutroV04 durationInFrames={OUTRO_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  );
};
