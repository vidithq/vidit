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

// The v0.5 promo B, "import and review": the brand intro, then ONE unbroken
// take of an archive import and a review pass (import-review.mp4), then the
// closing card.
//
// Like PromoV05, the recorded part is a single continuous window: no cut, no
// beat windowing, no hand-timed seconds. The only two transitions in the whole
// video are the crossfades into and out of the recorded part, where the world
// genuinely changes. Captions hang off the take's own marks, so a re-record
// needs `node gen-clips-manifest.js` and nothing else.
//
// One thing separates it from PromoV05: the import wait. The worker takes
// about half a minute to walk a real export, which is the truth of the product
// and cannot be shortened in the capture, but it is not half a minute of
// watchable film. Rather than cut it out, the comp plays the middle of it FAST
// over the same source, so the stepper ticks through under a caption that
// stays put and the picture never jumps. The compression is a playback rate on
// contiguous windows of one file, not an edit: see RAMP below.
//
// Beat 1 opens mid-form rather than on a still, so the intro carries the poster
// frame a tweet shows before anyone presses play.

const COMP_FPS = 60;
// Long enough to read as a dissolve rather than a cut.
const CROSSFADE = 18;

const CLIP = "import-review";

// Stage layout: identical to PromoV04 and PromoV05 so the promos cut together.
const CHROME_WIDTH = 1370;
const CHROME_HEIGHT = 830;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 24;
const CAPTION_FONT_SIZE = 40;

const INTRO_FRAMES = 144; // 2.4s
const OUTRO_FRAMES = 132; // 2.2s
// The intro starts slightly BEFORE the composition does, so the wordmark has
// already sprung in by frame 0, which is the poster frame.
const INTRO_LEAD = 12;

const clip = RECORDED[CLIP];
const mark = (key: string, fallback: number) => clip?.marks?.[key] ?? fallback;

const SUBMIT_URL = "vidit.app/submit";
const QUEUE_URL = "vidit.app/profile/MPGeoint/detections";
// The take picks the draft it reviews at record time (the brightest row on the
// queue's Ready filter that clears the submit floor), so the faked address bar
// stays at the route rather than naming an id the next re-record invalidates.
const REVIEW_URL = "vidit.app/events/…/edit?queue=1";
const MAP_URL = "vidit.app/map";

// ── the recorded window, and the one stretch of it that is compressed ──────
//
// Everything is counted in SOURCE frames, which are composition frames too:
// the take is captured at 60 fps and the comp runs at 60 fps, so one frame of
// the file is one frame of the film at rate 1.

const srcFrame = (sec: number) => Math.round(sec * COMP_FPS);

const TAKE_FROM = srcFrame(mark("panel", 0));
const TAKE_TO = srcFrame(
  Math.min(
    clip?.durationSec ?? 0,
    // the closing camera ease, then a short hold
    mark("mapEase", 68.43) + 2.4 + 1.2
  )
);

// The compressed stretch. It starts after the privacy line has been read at
// real speed and stops before the Done step lands, so both ends of the wait
// play at 1x and only the middle (the stepper counting through the export)
// races. RAMP_SCREEN is what that middle costs on screen.
const RAMP_LEAD_IN = 1.5;
const RAMP_LEAD_OUT = 1.0;
const RAMP_SCREEN = 4.2;

const RAMP_FROM = srcFrame(mark("privacyHold", 11.23) + RAMP_LEAD_IN);
const RAMP_TO = srcFrame(mark("importDone", 33.77) - RAMP_LEAD_OUT);
const RAMP_FRAMES = Math.round(RAMP_SCREEN * COMP_FPS);

type Segment = {
  /** First source frame this segment shows. */
  startFrom: number;
  /** How many frames it occupies in the film. */
  frames: number;
  /** Source frames consumed per film frame. */
  rate: number;
  /** Where it starts inside the recorded window. */
  start: number;
};

// Contiguous windows of the same file. Each one starts on the exact source
// frame the previous one ended on (`startFrom + frames * rate`), so nothing
// repeats and nothing is skipped at either join: the only thing that changes
// across a join is how fast the frames arrive.
const SEGMENTS: Segment[] = (() => {
  const out: Segment[] = [];
  let start = 0;
  const add = (startFrom: number, frames: number, rate: number) => {
    if (frames <= 0) return;
    out.push({ startFrom, frames, rate, start });
    start += frames;
  };
  const rampable = RAMP_FROM > TAKE_FROM && RAMP_TO > RAMP_FROM && RAMP_TO < TAKE_TO;
  if (!rampable) {
    // No usable import wait in the marks: play the take straight rather than
    // invent a ramp.
    add(TAKE_FROM, TAKE_TO - TAKE_FROM, 1);
    return out;
  }
  add(TAKE_FROM, RAMP_FROM - TAKE_FROM, 1);
  add(RAMP_FROM, RAMP_FRAMES, (RAMP_TO - RAMP_FROM) / RAMP_FRAMES);
  add(RAMP_TO, TAKE_TO - RAMP_TO, 1);
  return out;
})();

const TAKE_FRAMES = SEGMENTS.reduce((acc, s) => acc + s.frames, 0);

// A moment of the TAKE, in frames of the FILM. Captions and the address bar
// are anchored to marks, and a mark inside the compressed stretch has to land
// where that frame actually plays, so every cue converts through the segments
// rather than through wall-clock seconds.
const filmFrameAt = (takeSec: number): number => {
  const f = takeSec * COMP_FPS;
  for (const s of SEGMENTS) {
    const end = s.startFrom + s.frames * s.rate;
    if (f < end) return Math.max(0, s.start + (f - s.startFrom) / s.rate);
  }
  return TAKE_FRAMES;
};

const cueAt = (key: string, fallback: number, offset = 0) =>
  Math.round(filmFrameAt(mark(key, fallback) + offset));

// ── captions, anchored to the take's marks ────────────────────────────────

type CaptionCue = { at: number; eyebrow: string; title: string };

const CUES: CaptionCue[] = [
  {
    // The panel, the picker opening on the analyst's own export, and the
    // staged file. The dialog row and the staged card both read the real file
    // name and byte size, so what the frame names is what is imported.
    at: cueAt("panel", 0),
    eyebrow: "Bulk import",
    title: "Start from the export X already gives you.",
  },
  {
    // The product's own sentence, on the frame that carries it. It holds at
    // 1x for a moment and then rides the compressed wait, so it is the
    // longest line in the film.
    at: cueAt("privacyHold", 11.23),
    eyebrow: "Before the upload, in your browser",
    title: "DMs, messages and account data never leave your device.",
  },
  {
    // The finished run. This instance already holds every detection in the
    // export, so the outcome line reads as updates rather than as a haul, and
    // the caption says exactly that: it is the v0.5.2 upsert seen from
    // outside.
    at: cueAt("importDone", 33.77),
    eyebrow: "Import it again tomorrow",
    title: "It recognises the detections it already made.",
  },
  {
    at: cueAt("queueOpen", 37.4),
    eyebrow: "The queue",
    title: "Every machine detection, and what each one still needs.",
  },
  {
    at: cueAt("draftOpen", 46.45),
    eyebrow: "The review pass",
    title: "One form: the footage, the coordinates, the classification.",
  },
  {
    // From the click that arms Submit, so the line covers both clicks and the
    // next draft opening on its own.
    at: cueAt("submitClick", 60.26),
    eyebrow: "Submit",
    title: "Two clicks to freeze it, and the next detection opens itself.",
  },
  {
    // `mapUrl`, not `mapNav`: the take stamps `mapNav` before the cursor
    // starts for the sidebar, which would put the closing line up while the
    // review form is still on screen.
    at: cueAt("mapUrl", 65.61),
    eyebrow: "The map",
    title: "The work, gathered on one map.",
  },
];

// The address bar follows the take's real navigation, so the faked chrome
// never claims a page the recording is not on. Each URL mark is stamped the
// instant the route changed.
const URL_CUES: { at: number; url: string }[] = [
  { at: cueAt("panel", 0), url: SUBMIT_URL },
  { at: cueAt("queueUrl", 37.3), url: QUEUE_URL },
  { at: cueAt("draftUrl", 46.28), url: REVIEW_URL },
  { at: cueAt("mapUrl", 65.61), url: MAP_URL },
];

const pickAt = <T extends { at: number }>(cues: T[], frame: number): T =>
  cues.reduce((cur, c) => (frame >= c.at ? c : cur), cues[0]);

// ── timeline ──────────────────────────────────────────────────────────────

const TAKE_START = INTRO_FRAMES - INTRO_LEAD - CROSSFADE;
const OUTRO_START = TAKE_START + TAKE_FRAMES - CROSSFADE;
export const PROMO_V05B_DURATION = OUTRO_START + OUTRO_FRAMES;

const TakeStage: React.FC = () => {
  const frame = useCurrentFrame();
  const url = pickAt(URL_CUES, frame).url;
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
      {SEGMENTS.map((s) => (
        <Sequence key={s.start} from={s.start} durationInFrames={s.frames}>
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
              playbackRate={s.rate}
              // `startFrom` trims by wrapping the video in a sequence offset,
              // so the frame it shows is `startFrom + localFrame * rate`,
              // counted at the composition fps.
              startFrom={s.startFrom}
            />
          </div>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const PromoV05B: React.FC = () => {
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
        const next = CUES[i + 1];
        const to = next
          ? next.at
          : // The last caption clears before the take crossfades out, so it
            // never co-renders with the closing card.
            TAKE_FRAMES - CROSSFADE;
        const frames = to - cue.at;
        if (frames <= 0) return null;
        return (
          <Sequence
            key={cue.title}
            from={TAKE_START + cue.at}
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
