import { AbsoluteFill } from "remotion";

// Dark stage with a warm orange glow biased toward the bottom-right (the
// brand corner — where the "V" sits in the sidebar). The radial bloom is
// soft enough that it never competes with the captured UI in the centre.
export const Background: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 80% 90%, rgba(249, 115, 22, 0.18) 0%, rgba(249, 115, 22, 0) 55%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 10% 5%, rgba(251, 146, 60, 0.08) 0%, rgba(251, 146, 60, 0) 50%)",
        }}
      />
    </AbsoluteFill>
  );
};
