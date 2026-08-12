import { projectEquirectangular } from "@/lib/og";

import { OG_COLOR } from "./card";
import { OG_LANDMASS_PATH, OG_LANDMASS_VIEWBOX } from "./landmass";

// The event card's locator panel: a coastline outline under a plate-carrée
// graticule, with the event's point marked on it. The outline is committed path
// data (see `landmass.ts`) and the graticule is positioned rectangles, so
// rendering a card costs no basemap request, no tile provider key, and no new
// runtime dependency. A share card is a thumbnail, and the useful signal at
// that size is the region, which a coastline plus a graticule carries; the real
// map is one click away on the page.
//
// Satori supports `position: absolute` and needs an explicit `display` on every
// node, so each line is its own absolutely positioned flex div.

/** Graticule spacing in degrees, for both meridians and parallels. */
const GRATICULE_STEP = 30;

const MERIDIANS = 360 / GRATICULE_STEP;
const PARALLELS = 180 / GRATICULE_STEP;

export function OgMiniMap({
  lat,
  lng,
  width,
  height,
}: {
  lat: number;
  lng: number;
  width: number;
  height: number;
}) {
  const point = projectEquirectangular(lat, lng);
  const markerX = point.x * width;
  const markerY = point.y * height;
  const ring = 34;
  const dot = 12;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: "16px",
        border: `2px solid ${OG_COLOR.border}`,
        background: OG_COLOR.panel,
        overflow: "hidden",
      }}
    >
      {/* The world outline, under everything else. Its user space is the same
          plate-carrée frame the marker is projected into, scaled to the panel
          by the viewBox, so the coastline and the crosshair agree by
          construction and no coordinate is computed twice. */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${OG_LANDMASS_VIEWBOX.width} ${OG_LANDMASS_VIEWBOX.height}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <path
          d={OG_LANDMASS_PATH}
          fill={OG_COLOR.land}
          stroke={OG_COLOR.landEdge}
          strokeWidth={0.5}
          strokeLinejoin="round"
        />
      </svg>

      {/* Meridians. The prime meridian reads brighter, so the eye can place a
          point east or west of it without labels. */}
      {Array.from({ length: MERIDIANS - 1 }, (_, i) => i + 1).map((i) => (
        <div
          key={`m${i}`}
          style={{
            position: "absolute",
            display: "flex",
            top: 0,
            left: `${(i / MERIDIANS) * width}px`,
            width: "1px",
            height: `${height}px`,
            background: i === MERIDIANS / 2 ? OG_COLOR.gridMajor : OG_COLOR.grid,
          }}
        />
      ))}

      {/* Parallels, with the equator carrying the same emphasis. */}
      {Array.from({ length: PARALLELS - 1 }, (_, j) => j + 1).map((j) => (
        <div
          key={`p${j}`}
          style={{
            position: "absolute",
            display: "flex",
            left: 0,
            top: `${(j / PARALLELS) * height}px`,
            width: `${width}px`,
            height: "1px",
            background: j === PARALLELS / 2 ? OG_COLOR.gridMajor : OG_COLOR.grid,
          }}
        />
      ))}

      {/* Crosshair through the point, so the marker is findable at thumbnail
          size where a 12px dot on its own disappears. */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          top: 0,
          left: `${markerX}px`,
          width: "2px",
          height: `${height}px`,
          background: OG_COLOR.accentDim,
        }}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: 0,
          top: `${markerY}px`,
          width: `${width}px`,
          height: "2px",
          background: OG_COLOR.accentDim,
        }}
      />

      <div
        style={{
          position: "absolute",
          display: "flex",
          left: `${markerX - ring / 2}px`,
          top: `${markerY - ring / 2}px`,
          width: `${ring}px`,
          height: `${ring}px`,
          borderRadius: "999px",
          border: `3px solid ${OG_COLOR.accent}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: `${markerX - dot / 2}px`,
          top: `${markerY - dot / 2}px`,
          width: `${dot}px`,
          height: `${dot}px`,
          borderRadius: "999px",
          background: OG_COLOR.accent,
        }}
      />
    </div>
  );
}
