import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MONTSERRAT } from "../fonts";

// Brand intro — the orange "V" *is* the first letter of "Vidit".
//
// The whole wordmark "Vidit" is a single inline string; the leading V
// gets the brand orange + glow, the rest stays white. Animating both
// as one element means the V can't desync from the rest of the word.
export const Intro: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const wordIn = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.8 },
  });
  const wordScale = interpolate(wordIn, [0, 1], [0.85, 1]);
  const wordOpacity = interpolate(wordIn, [0, 1], [0, 1]);

  const tagIn = interpolate(frame, [22, 44], [0, 1], {
    extrapolateRight: "clamp",
  });

  const out = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: out,
        fontFamily: MONTSERRAT,
      }}
    >
      <div
        style={{
          fontSize: 144,
          fontWeight: 700,
          letterSpacing: -4,
          lineHeight: 1,
          transform: `scale(${wordScale})`,
          opacity: wordOpacity,
        }}
      >
        <span
          style={{
            color: "#f97316",
            textShadow:
              "0 0 60px rgba(249, 115, 22, 0.55), 0 20px 60px rgba(0, 0, 0, 0.4)",
          }}
        >
          V
        </span>
        <span style={{ color: "#fafafa" }}>idit</span>
      </div>
      <div
        style={{
          marginTop: 24,
          color: "#a3a3a3",
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: 0.4,
          opacity: tagIn,
        }}
      >
        The home for conflict geolocations
      </div>
    </AbsoluteFill>
  );
};
