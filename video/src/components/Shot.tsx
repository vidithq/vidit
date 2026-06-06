import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import {
  BrowserChrome,
  CHROME_HEADER_HEIGHT,
} from "./BrowserChrome";
import { Cursor, type CursorKeyframe } from "./Cursor";

// One scene: an image (PNG captured at 2560×1440 retina) framed by a
// faked browser window, animated with a Ken-Burns / targeted zoom.
//
// `from` and `to` are *focal points expressed as 0..1 in the image's own
// coordinate system* plus a scale. We compute the corresponding object-
// position (in % of the image, since CSS background/img positioning uses
// percentage of (image_size - container_size)) and the transform-origin so
// the named focal point stays put as we scale. This gives crisp,
// directable zooms instead of a generic Ken Burns drift.
export type Focus = {
  x: number; // 0..1, fraction of image width
  y: number; // 0..1, fraction of image height
  scale: number; // 1 = fit; >1 = pushed in
};

export type ShotLayer = {
  src: string;
  // Frame at which this layer reaches full opacity. The layer is faded
  // in over an 8-frame window centred on this frame.
  fadeInAt: number;
};

export const Shot: React.FC<{
  src: string;
  // Optional follow-up screenshots to crossfade IN. Use either
  // `srcAfter` (single swap) or `layers` (sequence of swaps) — layers
  // takes priority. The cursor stays continuous across every swap.
  srcAfter?: string;
  swapFrame?: number;
  layers?: ShotLayer[];
  url: string;
  from: Focus;
  to: Focus;
  durationInFrames: number;
  // Cursor keyframes are in image-ratio space (0..1) — they get projected
  // through the current Ken-Burns transform every frame so the cursor
  // stays glued to the UI element it's pointing at.
  cursor?: {
    path: CursorKeyframe[];
    clickFrame?: number;
    clickFrames?: number[];
  };
}> = ({
  src,
  srcAfter,
  swapFrame,
  layers,
  url,
  from,
  to,
  durationInFrames,
  cursor,
}) => {
  const frame = useCurrentFrame();

  // Stage layout: 1920×1080 canvas. Chrome sized so its bottom edge leaves
  // ~150px clear for the caption — captions stay OUT of the chrome instead
  // of overlapping form fields or content text.
  const chromeWidth = 1500;
  const chromeHeight = 904; // 60 header + 844 body (16:9 of 1500-wide body)
  const bodyHeight = chromeHeight - CHROME_HEADER_HEIGHT;

  // Animate the focal point and scale across the segment.
  const fx = interpolate(frame, [0, durationInFrames], [from.x, to.x], {
    extrapolateRight: "clamp",
  });
  const fy = interpolate(frame, [0, durationInFrames], [from.y, to.y], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(
    frame,
    [0, durationInFrames],
    [from.scale, to.scale],
    { extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: (1920 - chromeWidth) / 2,
        top: 32, // tighter to top so the caption band below has room
        width: chromeWidth,
        height: chromeHeight,
      }}
    >
      <BrowserChrome url={url} width={chromeWidth} height={chromeHeight}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
          }}
        >
          <Img
            src={staticFile(src)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale})`,
              transformOrigin: `${fx * 100}% ${fy * 100}%`,
            }}
          />
          {layers
            ? layers.map((layer, i) => (
                <Img
                  key={`${layer.src}-${i}`}
                  src={staticFile(layer.src)}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                    transformOrigin: `${fx * 100}% ${fy * 100}%`,
                    opacity: interpolate(
                      frame,
                      [layer.fadeInAt - 6, layer.fadeInAt + 6],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      }
                    ),
                  }}
                />
              ))
            : srcAfter && typeof swapFrame === "number" && (
                <Img
                  src={staticFile(srcAfter)}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                    transformOrigin: `${fx * 100}% ${fy * 100}%`,
                    opacity: interpolate(
                      frame,
                      [swapFrame - 8, swapFrame + 8],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      }
                    ),
                  }}
                />
              )}
          {/* Cursor & ripple — sibling of the image, so they DON'T get the
              Ken-Burns transform. Instead the Cursor projects its
              image-ratio keyframes through the current Focus, which keeps
              the pointer locked to its UI target even while the scene
              pushes in. */}
          {cursor && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: chromeWidth,
                height: bodyHeight,
                pointerEvents: "none",
              }}
            >
              <Cursor
                path={cursor.path}
                clickFrame={cursor.clickFrame}
                clickFrames={cursor.clickFrames}
                bodyWidth={chromeWidth}
                bodyHeight={bodyHeight}
                focus={{ x: fx, y: fy, scale }}
              />
            </div>
          )}
        </div>
      </BrowserChrome>
    </div>
  );
};
