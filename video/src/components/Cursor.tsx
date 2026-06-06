import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// macOS-style pointer rendered as inline SVG. Drawn so its hot-spot (the
// pointer tip) lands at the component's (x, y) — the SVG path begins at
// (0, 0), so the wrapper translates by (x, y) directly.
const CursorSprite: React.FC = () => (
  <svg width="36" height="36" viewBox="0 0 28 28" style={{ display: "block" }}>
    <defs>
      <filter id="cur-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.4" />
        <feOffset dy="1.5" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.55" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M 2 2 L 2 22 L 7.5 17.5 L 11 25 L 14 23.5 L 10.5 16 L 18 16 Z"
      fill="white"
      stroke="black"
      strokeWidth="1.2"
      strokeLinejoin="round"
      filter="url(#cur-shadow)"
    />
  </svg>
);

// Keyframe in IMAGE-RATIO space: x, y in 0..1 relative to the underlying
// screenshot. Projected per-frame through the current Ken-Burns transform
// so the cursor stays glued to the UI element it's pointing at, even as
// the image zooms and pans beneath it.
export type CursorKeyframe = {
  frame: number;
  x: number; // 0..1, ratio of image width
  y: number; // 0..1, ratio of image height
};

// Smooth eased path through keyframes. Between any two keyframes we
// drive a unit progress 0→1 with an ease-in-out, then linearly mix in
// 2D — so the trajectory is a polyline but velocity is smooth at every
// join.
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function interpolatePath(
  frame: number,
  keys: CursorKeyframe[]
): { x: number; y: number } {
  if (keys.length === 0) return { x: 0, y: 0 };
  if (frame <= keys[0].frame) return { x: keys[0].x, y: keys[0].y };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const raw = (frame - a.frame) / (b.frame - a.frame);
      const t = easeInOut(raw);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last.x, y: last.y };
}

// Current per-frame projection: image-space ratios → body-space pixels,
// accounting for the Shot's scale + transform-origin (in image ratios).
export function projectImgToBody(
  ratio: { x: number; y: number },
  bodyWidth: number,
  bodyHeight: number,
  focus: { x: number; y: number; scale: number }
): { x: number; y: number } {
  const imgX = ratio.x * bodyWidth; // 1:1 because image aspect == body aspect
  const imgY = ratio.y * bodyHeight;
  const originX = focus.x * bodyWidth;
  const originY = focus.y * bodyHeight;
  return {
    x: originX + (imgX - originX) * focus.scale,
    y: originY + (imgY - originY) * focus.scale,
  };
}

// Click ripple — single expanding/fading ring + a quick scale-pulse on
// the cursor itself, fired at `clickFrame` and resolving over ~22 frames.
export const Cursor: React.FC<{
  path: CursorKeyframe[];
  clickFrame?: number;
  clickFrames?: number[];
  bodyWidth: number;
  bodyHeight: number;
  focus: { x: number; y: number; scale: number };
}> = ({
  path,
  clickFrame,
  clickFrames,
  bodyWidth,
  bodyHeight,
  focus,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ratio = interpolatePath(frame, path);
  const { x, y } = projectImgToBody(ratio, bodyWidth, bodyHeight, focus);

  // Unify: single clickFrame and clickFrames[] both resolve to a list.
  const allClicks: number[] = [
    ...(typeof clickFrame === "number" ? [clickFrame] : []),
    ...(clickFrames ?? []),
  ];
  // Active click — the most recent one whose 22-frame window contains
  // the current frame.
  const activeClick = allClicks
    .filter((cf) => frame >= cf && frame < cf + 22)
    .pop();
  const clickFiring = typeof activeClick === "number";
  const clickLocal = clickFiring ? frame - activeClick! : 0;
  const rippleScale = clickFiring
    ? interpolate(clickLocal, [0, 21], [0.4, 2.2])
    : 0;
  const rippleOpacity = clickFiring
    ? interpolate(clickLocal, [0, 21], [0.55, 0])
    : 0;

  const press = clickFiring
    ? spring({
        frame: frame - activeClick!,
        fps,
        config: { damping: 9, mass: 0.4, stiffness: 220 },
      })
    : 0;
  const cursorScale = clickFiring ? 1 - 0.06 * press : 1;

  return (
    <>
      {clickFiring && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 44,
            height: 44,
            marginLeft: -22,
            marginTop: -22,
            borderRadius: "50%",
            border: "2.5px solid #f97316",
            background: "rgba(249, 115, 22, 0.18)",
            transform: `scale(${rippleScale})`,
            opacity: rippleOpacity,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `scale(${cursorScale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <CursorSprite />
      </div>
    </>
  );
};
