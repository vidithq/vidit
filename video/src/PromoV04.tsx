import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { Background } from "./components/Background";
import { BotBeat } from "./components/BotBeat";
import { Caption } from "./components/Caption";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { DROP_INS, RECORDED } from "./clips-manifest";

// The v0.4 promo. Five in-app beats windowed out of ONE continuous
// recorded take (demo.mp4: map → submit → import → queue → review →
// published detail, single session), then the bot beat (drop-in capture or
// mockup over the X-embed plate) and the outro:
//
//   1. The map: camera dezoom, back in, drag pan, open an event,
//      scroll its proofs.
//   2. Sidemenu → /submit, bulk archive import (Finder pick), live scan.
//   3. The redirect lands on the queue; open the promote-ready draft.
//   4. Fill conflict + capture source, review scroll, submit, the
//      published detail via the profile.
//   5. The @viditbot on-ramp (X only; fades to the outro).
//
// Because every in-app beat is a window of the SAME take, a beat junction
// is a plain jump cut within one session: same sidebar, same page flow, no
// inter-take seam. Cuts sit on still moments or on recorded navigation
// clicks; only the bot beat (a change of world, into X) and the outro fade.
// All timings come from src/clips-manifest.ts (generated from the take's
// marks), so a re-record only needs `node gen-clips-manifest.js` before the
// render; nothing here is hand-timed against wall-clock seconds.

const COMP_FPS = 60;
const FADE = 12;

// Stage layout: the recording is letterboxed high in the frame, and the
// band below (y ≈ 854..1080) is reserved for captions, so a caption can
// never overlap the demo.
const CHROME_WIDTH = 1370;
const CHROME_HEIGHT = 830;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 24;
const CAPTION_FONT_SIZE = 42;

type Window = { clip: keyof typeof RECORDED; from: number; to: number };

// One in-take window of a recorded clip. `from`/`to` are seconds in the
// source recording; the segment plays 1:1 (the comp upsamples the clip's
// measured fps to 60).
function win(clip: keyof typeof RECORDED, from: number, to: number): Window {
  const meta = RECORDED[clip];
  const lo = Math.max(0, Math.min(from, meta.durationSec - 0.1));
  const hi = Math.max(lo + 0.1, Math.min(to, meta.durationSec));
  return { clip, from: lo, to: hi };
}

const winFrames = (w: Window) => Math.round((w.to - w.from) * COMP_FPS);

const mark = (clip: keyof typeof RECORDED, key: string, fallback: number) =>
  RECORDED[clip]?.marks?.[key] ?? fallback;

// ── the storyboard, in windows ────────────────────────────────────────────

const D = (k: string, f: number) => mark("demo", k, f);

type Beat = {
  name: string;
  windows?: Window[]; // recorded windows, played back to back (jump cuts)
  botFrames?: number; // the bot mockup / drop-in segment, in comp frames
  caption?: { eyebrow: string; title: string };
  // Fade the beat's video in/out (bot + the opening only); in-app beats
  // hard-cut into each other on the recorded nav clicks.
  fadeIn?: boolean;
  fadeOut?: boolean;
};

const BOT_OVERLAY_SECONDS = 9.5;
const botCaptureSeconds = DROP_INS.botCapture
  ? Math.min(DROP_INS.botCapture.durationSec, 14)
  : BOT_OVERLAY_SECONDS;

const BEATS: Beat[] = [
  {
    name: "map",
    fadeIn: true, // only from black at the very top of the video
    windows: [
      // Cold open on the pin field, then the continuous camera dezoom.
      win("demo", D("dezoom", 2.4) - 0.5, D("dezoom", 2.4) + 3.1),
      // One continuous move: camera back in toward the hero, then the
      // drag pan walks the pin toward center.
      win("demo", D("rezoom", 9) - 0.2, D("pan", 13) + 1.7),
      // Warm-up hover on a neighbour pin (its preview card pops), then the
      // hero: its preview breathes, the click opens the panel on the real
      // work. One continuous window so both previews read on camera.
      win("demo", D("pinHover", 16) - 0.2, D("panelOpen", 19) + 1.4),
      // Scroll inside the detail panel: the proofs read on camera.
      win("demo", D("panelScroll", 23) - 0.1, D("panelScroll", 23) + 3.0),
    ],
    caption: {
      eyebrow: "The map",
      title: "Browse documented geolocations, no account needed.",
    },
  },
  {
    name: "import",
    windows: [
      // The sidemenu Submit click happens on camera; the cut in lands on
      // the still map just before the glide.
      win("demo", D("navSubmit", 30) - 0.6, D("navSubmit", 30) + 1.6),
      // One continuous shot: switch to Bulk import, the guide renders and
      // breathes, then the eased scroll down to the drop zone. No cut around
      // the scroll — a cut mid-gesture read as a stutter.
      win("demo", D("modeClick", 35) - 0.3, D("scrollGuide", 38) + 2.2),
      // The Finder dialog: glide to the archive, select, double-click.
      win("demo", D("finderOpen", 41) - 0.5, D("finderPick", 46) + 1.0),
      // The file card breathes, click Import, then the eased scroll down to
      // the freshly mounted stepper (one continuous shot).
      win("demo", D("importClick", 51) - 1.6, D("importClick", 51) + 2.6),
      // The live extraction counter.
      win("demo", D("scanVisible", 54) + 0.2, D("scanVisible", 54) + 2.6),
      // The finished stepper (Done + counts), then the click on Review your
      // detections; the window ends just before the queue page lands so the
      // beat junction rides the navigation itself.
      win("demo", D("queueRedirect", 80) - 2.4, D("queueRedirect", 80) - 0.05),
    ],
    caption: {
      eyebrow: "Bulk import",
      title:
        "Upload your X archive and every geolocation you ever posted is found in minutes.",
    },
  },
  {
    name: "queue",
    windows: [
      // Open on the freshly landed queue (the import beat ended on the CTA
      // click, so the junction IS the page swap).
      win("demo", D("queueRedirect", 80) + 0.05, D("queueRedirect", 80) + 2.4),
      // Eased scroll to the promote-ready draft, open it, its top breathes.
      // The target sits on queue page 1 (pickPromoteTarget prefers it), so
      // this cut lands on the same list, not a paginated-away page.
      win("demo", D("draftApproach", 85) - 0.4, D("draftOpen", 90) + 1.7),
    ],
    caption: {
      eyebrow: "Detections",
      title: "Each find becomes a detection, waiting for your review.",
    },
  },
  {
    name: "promote",
    windows: [
      // The human's part, on camera: type the conflict, pick it, click the
      // capture-source chip. One continuous window.
      win("demo", D("conflictFocus", 95) - 0.3, D("capturePick", 102) + 1.0),
      // The eased review scroll down the whole draft.
      win("demo", D("reviewScroll", 106) - 0.2, D("reviewScroll", 106) + 4.3),
      // Submit → Confirm & submit → the queue again, one row lighter.
      win("demo", D("submit", 113) - 0.5, D("published", 117) + 1.4),
    ],
    caption: {
      eyebrow: "Review",
      title: "Detected tweets become geolocations once you review and submit them.",
    },
  },
  {
    // The analyst payoff (v0.4 field feedback): work that lived scattered
    // across threads is now one place ON the map. Back to /map, the Author
    // filter narrows the pin field to the analyst's own handle, and one of
    // the fresh machine detections opens. Same take, own caption.
    name: "onePlace",
    fadeOut: true, // into the bot beat (a change of world, allowed to fade)
    windows: [
      // Sidemenu Map click; cut right after the click, BEFORE the map page
      // lands (the restored detail panel would flash for a beat otherwise —
      // the take dismisses it off camera during the settle).
      win("demo", D("mapReturn", 121) - 0.3, D("mapReturn", 121) + 0.85),
      // One continuous gesture: open the Author section, type the handle,
      // pick @analyst, the map refetches down to the analyst's work.
      win("demo", D("authorOpen", 126) - 0.3, D("authorPick", 129.5) + 1.9),
      // Collapse the filter panel (on camera), then the camera ease onto
      // the filtered work — one continuous shot.
      win("demo", D("filtersClose", 131.5) - 0.2, D("workEase", 133) + 2.6),
      // Approach a detected pin, its draft panel opens and holds.
      win("demo", D("detectedApproach", 135) - 0.2, D("detectedOpen", 137) + 3.2),
    ],
    caption: {
      eyebrow: "Your work",
      title: "Your work, once scattered across threads, becomes one browsable record.",
    },
  },
  {
    name: "bot",
    fadeIn: true,
    fadeOut: true,
    botFrames: Math.round(botCaptureSeconds * COMP_FPS),
    // X only: the beat fades straight into the outro, no return to the app.
    caption: {
      eyebrow: "@viditbot",
      title: "Tag @viditbot on a new geolocation and it lands in your detections.",
    },
  },
];

const OUTRO_FRAMES = 320; // 5.3s

// ── timeline assembly ─────────────────────────────────────────────────────

type PlacedBeat = Beat & { start: number; frames: number };

// Beats butt-join (hard cuts); only the outro overlaps the bot beat's
// fade-out, crossfading like before.
let _cursor = 0;
const PLACED: PlacedBeat[] = BEATS.map((beat) => {
  const frames =
    (beat.botFrames ?? 0) +
    (beat.windows ?? []).reduce((acc, w) => acc + winFrames(w), 0);
  const start = _cursor;
  _cursor = start + frames;
  return { ...beat, start, frames };
});
const OUTRO_START = _cursor - FADE;
export const PROMO_V04_DURATION = OUTRO_START + OUTRO_FRAMES;

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

const ChromeStage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      left: CHROME_LEFT,
      top: CHROME_TOP,
      width: CHROME_WIDTH,
      height: CHROME_HEIGHT,
    }}
  >
    {children}
  </div>
);

const RecordedWindow: React.FC<{ w: Window }> = ({ w }) => {
  const meta = RECORDED[w.clip];
  return (
    <ChromeStage>
      <VideoChrome
        src={meta.src}
        url="vidit.app"
        width={CHROME_WIDTH}
        height={CHROME_HEIGHT}
        // `startFrom` counts frames at the COMPOSITION fps (Remotion maps
        // them to source seconds internally, whatever fps the clip was
        // encoded at), so the window offset converts with COMP_FPS.
        startFrom={Math.round(w.from * COMP_FPS)}
      />
    </ChromeStage>
  );
};

export const PromoV04: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      {PLACED.map((beat) => {
        // Inside a beat: the optional bot segment first, then each recorded
        // window back to back.
        const segments: React.ReactNode[] = [];
        let offset = 0;
        if (beat.botFrames) {
          segments.push(
            <Sequence key="bot" from={offset} durationInFrames={beat.botFrames}>
              <ChromeStage>
                <BotBeat
                  width={CHROME_WIDTH}
                  height={CHROME_HEIGHT}
                  capture={DROP_INS.botCapture}
                />
              </ChromeStage>
            </Sequence>
          );
          offset += beat.botFrames;
        }
        for (const [i, w] of (beat.windows ?? []).entries()) {
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
              {beat.caption && (
                <Caption
                  eyebrow={beat.caption.eyebrow}
                  title={beat.caption.title}
                  fontSize={CAPTION_FONT_SIZE}
                  // End the caption's own fade-out before a fading beat's
                  // video fade, so two captions never co-render.
                  durationInFrames={beat.frames - (beat.fadeOut ? FADE : 0)}
                />
              )}
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
