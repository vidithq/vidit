import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MONTSERRAT } from "../fonts";

// Lower-third caption — title (orange-accent eyebrow) above a single-line
// headline. Slides up with a spring, fades out at the tail of its segment.
export const Caption: React.FC<{
  eyebrow?: string;
  title: string;
  durationInFrames: number;
  /** Headline size; the v0.4 comp passes a smaller value so two-line
   *  captions stay inside their reserved band below the recording. */
  fontSize?: number;
}> = ({ eyebrow, title, durationInFrames, fontSize = 48 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 110, mass: 0.7 },
  });
  const translateY = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  // Fade out the last 14 frames of the segment.
  const exit = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 40,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity: opacity * exit,
          textAlign: "center",
          maxWidth: 1300,
          fontFamily: MONTSERRAT,
        }}
      >
        {eyebrow && (
          <div
            style={{
              color: "#fb923c",
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 2.6,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            {eyebrow}
          </div>
        )}
        <div
          style={{
            color: "#fafafa",
            fontSize,
            fontWeight: 600,
            letterSpacing: -0.6,
            lineHeight: 1.1,
            textShadow: "0 4px 24px rgba(0, 0, 0, 0.55)",
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
