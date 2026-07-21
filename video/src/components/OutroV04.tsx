import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MONTSERRAT } from "../fonts";

// v0.4 closing card: the wordmark (orange capital V, near-white rest, no
// underline), the address, and the open-source line. Nothing else; the beats
// already showed the product.
export const OutroV04: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const inSpring = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 100 },
  });
  const opacity = interpolate(inSpring, [0, 1], [0, 1]);
  const y = interpolate(inSpring, [0, 1], [22, 0]);

  const urlIn = interpolate(frame, [26, 48], [0, 1], {
    extrapolateRight: "clamp",
  });
  const pillIn = interpolate(frame, [48, 70], [0, 1], {
    extrapolateRight: "clamp",
  });
  const out = interpolate(
    frame,
    [durationInFrames - 16, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        fontFamily: MONTSERRAT,
        opacity: out,
      }}
    >
      <div
        style={{
          fontSize: 132,
          fontWeight: 700,
          letterSpacing: -3.5,
          lineHeight: 1,
          opacity,
          transform: `translateY(${y}px)`,
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
          marginTop: 26,
          color: "#d4d4d4",
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: 0.6,
          opacity: urlIn,
        }}
      >
        vidit.app
      </div>
      <div
        style={{
          marginTop: 26,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 20px",
          borderRadius: 9999,
          border: "1px solid rgba(249, 115, 22, 0.4)",
          background: "rgba(249, 115, 22, 0.08)",
          color: "#fb923c",
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: 0.3,
          opacity: pillIn,
        }}
      >
        Open source · AGPL
      </div>
    </AbsoluteFill>
  );
};
