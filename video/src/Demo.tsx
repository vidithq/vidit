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
import { Outro } from "./components/Outro";
import { VideoChrome } from "./components/VideoChrome";

// Final promo — 3 scenes, ~68s at 60fps (4082 frames; see SCENES + FADE
// below for the exact accounting).
//   1. Vidit intro (V mark + wordmark + tagline).
//   2. ONE continuous recording of the platform: map → sidebar tour →
//      submit flow (paste, import, tag, publish) → naturally lands on
//      the just-published geolocation → glides to bounties. Captions
//      change throughout, following the flow.
//   3. Closing outro (CTA).
//
// The recording is ~60s of real Chrome at 30fps (see SCENES.video.frames
// below for the exact duration in comp frames); the comp runs at 60fps,
// so OffthreadVideo upsamples (every source frame plays twice).
// VideoChrome wraps the recording in the same faked browser window the
// still scenes used.
// No more "skip startup" — filters are pre-collapsed in the recording's
// setup phase, so the first frame is already a clean dense map. We
// keep the full recording so the new map cold-open beat (~3s of pin
// field before the cursor starts moving) reads.
const VIDEO_SKIP_SECONDS = 0;
// FPS the recording was captured at (see `FPS` in record-submit.js).
// `<OffthreadVideo startFrom>` is in SOURCE frames at the source's fps,
// so the seconds-to-frames math has to use this, not the comp's 60.
const RECORDING_FPS = 30;

const SCENES = [
  { name: "intro", frames: 180 },   // 3s
  { name: "video", frames: 4140 },  // 69s @ 60fps — full recording flow
                                    // (`STOP_AFTER_SUBMIT=false`) lands
                                    // around ~67s wall-clock with the
                                    // 4-step proof-edit beat. 69s
                                    // leaves a small buffer past the
                                    // recording's end so the outro
                                    // fade-in catches the last beat.
  { name: "outro", frames: 360 },   // 6s — fits the "Also in the platform" list
] as const;

const FADE = 14;

let _cursor = 0;
const SCENE_AT: Record<string, { start: number; duration: number }> = {};
SCENES.forEach((s, i) => {
  const start = i === 0 ? 0 : _cursor - FADE;
  SCENE_AT[s.name] = { start, duration: s.frames };
  _cursor = start + s.frames;
});
export const DEMO_DURATION = _cursor;

const SceneFade: React.FC<{
  duration: number;
  children: React.ReactNode;
}> = ({ duration, children }) => {
  const f = useCurrentFrame();
  const opacity = interpolate(
    f,
    [0, FADE, duration - FADE, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// Stage layout for the chromed video (matches the still scenes).
const CHROME_WIDTH = 1500;
const CHROME_HEIGHT = 904;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 32;

// Caption timeline within the video segment. `from` is relative to the
// start of the video Sequence (comp frames at 60fps); no skip now, so
// comp time == recording time.
//
// Recording timing (observed, with the extended 3.5 s map breath):
//   0–4s    /map breath (dense pin field, no cursor motion)
//   4–7s    sidebar expand + tour
//   7–10s   click Submit → /geolocations/new + sidebar collapse
//   10–25s  submit flow: paste → import → tag → publish
//   25–31s  the just-published geolocation detail page
//   31–42s  bounties list + click bounty + "I'm working on this"
//   42–59s  Post bounty form: type title + paste URL + media + submit
// Captions are anchored to the beat they describe — "Review" and
// "Publish" live on their own beats (proof-edit, submit) instead of
// being smuggled into the form-fill caption. The 5–10s sidebar-tour
// beat is intentionally silent; a label there would compete with the
// nav exposition.
const CAPTIONS: { from: number; frames: number; title: string; eyebrow?: string }[] = [
  {
    from: 0,
    frames: 60 * 5, // 0–5s — opens on the dense map
    eyebrow: "The archive",
    title: "Every conflict event. One map.",
  },
  {
    from: 60 * 10,
    frames: 60 * 12, // 10–22s — paste tweet URL → Import → tag pick
    eyebrow: "Auto-fill",
    title: "Paste a tweet. The form fills itself.",
  },
  {
    from: 60 * 22,
    frames: 60 * 10, // 22–32s — proof-edit beat (scroll, 4× drag-
                     // select + Delete: `(img …)`, `Geolocation: …`,
                     // both `t.co/…` URLs)
    eyebrow: "Proof",
    title: "Review the auto-fill. Strip the noise.",
  },
  {
    from: 60 * 32,
    frames: 60 * 7, // 32–39s — scroll to Submit + click + redirect +
                    // hold on the new geolocation's detail page
    eyebrow: "Publish",
    title: "One click. It joins the archive.",
  },
  {
    from: 60 * 39,
    frames: 60 * 11, // 39–50s — bounty browse + click + "I'm working
                     // on this"
    eyebrow: "Bounties",
    title: "See what other analysts are working on. Lend a hand.",
  },
  {
    from: 60 * 50,
    frames: 60 * 16, // 50–66s — post-bounty form (title typed, URL
                     // pasted, media attached, slow scroll, submit,
                     // hold on the new bounty's detail page)
    eyebrow: "Bounties",
    title: "Or post your own — the community picks it up.",
  },
];

export const Demo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      {/* ── 1. Intro ────────────────────────────────────────────── */}
      <Sequence
        from={SCENE_AT.intro.start}
        durationInFrames={SCENE_AT.intro.duration}
      >
        <Intro durationInFrames={SCENE_AT.intro.duration} />
      </Sequence>

      {/* ── 2. One continuous recording, captions overlay ───────── */}
      <Sequence
        from={SCENE_AT.video.start}
        durationInFrames={SCENE_AT.video.duration}
      >
        <SceneFade duration={SCENE_AT.video.duration}>
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
              src="recording-submit.mp4"
              url="vidit.app"
              width={CHROME_WIDTH}
              height={CHROME_HEIGHT}
              startFrom={VIDEO_SKIP_SECONDS * RECORDING_FPS}
            />
          </div>
          {/* Captions: each lives in its own nested Sequence so its
              `useCurrentFrame()` resets to 0 at `from`, which lets the
              Caption component drive its own spring-in / fade-out
              without bookkeeping per-segment offsets. */}
          {CAPTIONS.map((c, i) => (
            <Sequence key={i} from={c.from} durationInFrames={c.frames}>
              <Caption
                eyebrow={c.eyebrow}
                title={c.title}
                durationInFrames={c.frames}
              />
            </Sequence>
          ))}
        </SceneFade>
      </Sequence>

      {/* ── 3. Outro ────────────────────────────────────────────── */}
      <Sequence
        from={SCENE_AT.outro.start}
        durationInFrames={SCENE_AT.outro.duration}
      >
        <Outro durationInFrames={SCENE_AT.outro.duration} />
      </Sequence>
    </AbsoluteFill>
  );
};
