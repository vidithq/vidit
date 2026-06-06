import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MONTSERRAT } from "../fonts";

// Closing CTA — wordmark + features-not-shown list + beta pill.
//
// The promo only walks the import-publish + bounty story; the list of
// features here makes clear there's more to the platform than what was
// just demoed, without burning recording time on each.
const ALSO_IN_VIDIT = ["Timeline", "Search", "Filters", "Profiles"];

export const Outro: React.FC<{ durationInFrames: number }> = ({
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

  const pillIn = interpolate(frame, [22, 42], [0, 1], {
    extrapolateRight: "clamp",
  });

  // "Also in Vidit" section fades in after the wordmark + pill have
  // settled, so the eye reads them in order.
  const alsoLabelIn = interpolate(frame, [60, 90], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        fontFamily: MONTSERRAT,
      }}
    >
      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2.5,
          lineHeight: 1,
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        <span
          style={{
            color: "#f97316",
            textShadow: "0 0 70px rgba(249, 115, 22, 0.5)",
          }}
        >
          v
        </span>
        <span style={{ color: "#fafafa" }}>idit.app</span>
      </div>
      <div
        style={{
          marginTop: 32,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 20px",
          borderRadius: 9999,
          border: "1px solid rgba(249, 115, 22, 0.4)",
          background: "rgba(249, 115, 22, 0.08)",
          color: "#fb923c",
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: 0.2,
          opacity: pillIn,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "#f97316",
            boxShadow: "0 0 14px rgba(249, 115, 22, 0.9)",
          }}
        />
        Closed beta · invite-only
      </div>

      <div
        style={{
          marginTop: 70,
          textAlign: "center",
          opacity: alsoLabelIn,
        }}
      >
        <div
          style={{
            color: "#737373",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Also in the platform
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 1100,
          }}
        >
          {ALSO_IN_VIDIT.map((f, i) => (
            <React.Fragment key={f}>
              {i > 0 && (
                <span
                  style={{
                    color: "#404040",
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  •
                </span>
              )}
              <span
                style={{
                  color: "#d4d4d4",
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: 0.2,
                }}
              >
                {f}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
