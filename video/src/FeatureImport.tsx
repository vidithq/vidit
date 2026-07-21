import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Background } from "./components/Background";
import { BrowserChrome } from "./components/BrowserChrome";
import { Caption } from "./components/Caption";
import { OutroV04 } from "./components/OutroV04";
import { VideoChrome } from "./components/VideoChrome";
import { MONTSERRAT } from "./fonts";
import { DROP_INS, RECORDED } from "./clips-manifest";

// GROUNDWORK for the follow-up FEATURE video on the archive import (posted
// as its own tweet after the main promo). Not rendered for v0.4; it ships
// when the maintainer records the real X export screen into
// public/clips/x-export-capture.mp4 (then: node gen-clips-manifest.js and
// render the `FeatureImport` composition).
//
//   1. Real X footage: Settings → "Download an archive of your data"
//      (drop-in slot; a styled placeholder card renders until the capture
//      exists so the comp always previews end to end).
//   2. The import stretch of the demo take, at fuller length than the
//      promo cut.
//   3. Outro.

const COMP_FPS = 60;
const FADE = 12;
// Same letterbox + reserved caption band as PromoV04.
const CHROME_WIDTH = 1370;
const CHROME_HEIGHT = 830;
const CHROME_LEFT = (1920 - CHROME_WIDTH) / 2;
const CHROME_TOP = 24;

const I = (k: string, f: number) => RECORDED.demo?.marks?.[k] ?? f;

const EXPORT_SECONDS = DROP_INS.exportCapture
  ? Math.min(DROP_INS.exportCapture.durationSec, 6)
  : 3;

type Win = { from: number; to: number };
const IMPORT_WINDOWS: Win[] = [
  { from: I("modeClick", 1.1) - 0.6, to: I("importClick", 8.9) + 0.8 },
  { from: I("scanVisible", 11.8) - 0.4, to: I("scanVisible", 11.8) + 2.2 },
  { from: I("queueRedirect", 14.8) - 0.2, to: I("draftOpen", 18.9) + 2.0 },
];
const importFrames = IMPORT_WINDOWS.reduce(
  (acc, w) => acc + Math.round((w.to - w.from) * COMP_FPS),
  0
);

const EXPORT_FRAMES = Math.round(EXPORT_SECONDS * COMP_FPS);
const OUTRO_FRAMES = 300;
export const FEATURE_IMPORT_DURATION =
  EXPORT_FRAMES + importFrames + OUTRO_FRAMES - FADE;

// Placeholder until the maintainer's real capture drops in: the X-side steps,
// stated as text (no imitation of X's actual settings UI).
const ExportPlaceholder: React.FC = () => (
  <AbsoluteFill
    style={{
      background: "#000",
      fontFamily: MONTSERRAT,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div style={{ textAlign: "center", maxWidth: 900 }}>
      <div
        style={{
          color: "#71767b",
          fontSize: 18,
          letterSpacing: 2.4,
          textTransform: "uppercase",
          marginBottom: 18,
        }}
      >
        On X
      </div>
      <div style={{ color: "#e7e9ea", fontSize: 40, fontWeight: 600, lineHeight: 1.3 }}>
        Settings → Your account →{"\n"}
        {"“"}Download an archive of your data{"”"}
      </div>
      <div style={{ color: "#71767b", fontSize: 20, marginTop: 22 }}>
        (real screen capture drops in at public/clips/x-export-capture.mp4)
      </div>
    </div>
  </AbsoluteFill>
);

const SceneFade: React.FC<{ duration: number; children: React.ReactNode }> = ({
  duration,
  children,
}) => {
  const f = useCurrentFrame();
  const opacity = interpolate(
    f,
    [0, FADE, duration - FADE, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const FeatureImport: React.FC = () => {
  const importMeta = RECORDED.demo;
  return (
    <AbsoluteFill>
      <Background />

      <Sequence from={0} durationInFrames={EXPORT_FRAMES}>
        <SceneFade duration={EXPORT_FRAMES}>
          <div
            style={{
              position: "absolute",
              left: CHROME_LEFT,
              top: CHROME_TOP,
              width: CHROME_WIDTH,
              height: CHROME_HEIGHT,
            }}
          >
            <BrowserChrome url="x.com/settings" width={CHROME_WIDTH} height={CHROME_HEIGHT}>
              {DROP_INS.exportCapture ? (
                <OffthreadVideo
                  src={staticFile(DROP_INS.exportCapture.src)}
                  muted
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <ExportPlaceholder />
              )}
            </BrowserChrome>
          </div>
          <Caption
            eyebrow="Step 1"
            title="Request your data archive on X."
            durationInFrames={EXPORT_FRAMES}
          />
        </SceneFade>
      </Sequence>

      {importMeta &&
        (() => {
          let offset = EXPORT_FRAMES - FADE;
          const total = importFrames;
          const start = offset;
          const segs = IMPORT_WINDOWS.map((w, i) => {
            const frames = Math.round((w.to - w.from) * COMP_FPS);
            const seq = (
              <Sequence key={i} from={offset - start} durationInFrames={frames}>
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
                    src={importMeta.src}
                    url="vidit.app"
                    width={CHROME_WIDTH}
                    height={CHROME_HEIGHT}
                    startFrom={Math.round(w.from * COMP_FPS)}
                  />
                </div>
              </Sequence>
            );
            offset += frames;
            return seq;
          });
          return (
            <Sequence from={start} durationInFrames={total}>
              <SceneFade duration={total}>
                {segs}
                <Caption
                  eyebrow="Step 2"
                  title="Upload it. Every coordinate you ever posted becomes a draft."
                  durationInFrames={total}
                />
              </SceneFade>
            </Sequence>
          );
        })()}

      <Sequence
        from={EXPORT_FRAMES - FADE + importFrames - FADE}
        durationInFrames={OUTRO_FRAMES}
      >
        <OutroV04 durationInFrames={OUTRO_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  );
};
