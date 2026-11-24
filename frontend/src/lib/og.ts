// Pure helpers behind the share cards (`app/**/opengraph-image.tsx`), kept out of the
// Satori modules so they stay testable without the `node:fs` font read.

import { pluralNoun } from "@/lib/format";
import type { PublicProfile, UserStats } from "@/lib/users";

/** Equirectangular world projection, normalised to the unit square. */
interface ProjectedPoint {
  /** 0 at 180°W, 1 at 180°E. */
  x: number;
  /** 0 at the north pole, 1 at the south pole. */
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Plate carrée projection onto the card's world panel. Out-of-range values clamp so a
 *  stray value cannot draw a marker outside the panel. */
export function projectEquirectangular(lat: number, lng: number): ProjectedPoint {
  return {
    x: clamp01((lng + 180) / 360),
    y: clamp01((90 - lat) / 180),
  };
}

/** Shorten to `max` characters, cutting on a word boundary in the last quarter of the
 *  budget. Satori's line clamping is unreliable. */
export function ogTruncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  // Cut over code points: slicing a surrogate pair leaves a lone surrogate that renders as a
  // replacement box.
  const points = Array.from(cleaned);
  if (points.length <= max) return cleaned;
  const cut = points.slice(0, max - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.75 ? cut.slice(0, lastSpace) : cut.trimEnd();
  return `${body}…`;
}

export function ogCount(value: number): string {
  return value.toLocaleString("en-US");
}

interface OgProfileCount {
  label: string;
  value: number;
}

/** An analyst's headline counts for the share card and the link description, credited as the
 *  profile credits them: geolocated and detected are the Insights figures (co-geolocated events
 *  included), followers the header's. A failed stats read keeps geolocated off
 *  `geolocations_count`, the same figure, and drops detected. */
export function ogProfileCounts(profile: PublicProfile, stats: UserStats | null): OgProfileCount[] {
  return [
    { label: "Geolocated", value: stats?.geolocated_count ?? profile.geolocations_count },
    ...(stats ? [{ label: "Detected", value: stats.detected_count }] : []),
    { label: pluralNoun(profile.followers_count, "Follower"), value: profile.followers_count },
  ];
}

export interface OgMosaicBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A mosaic panel's outer box and the gap between tiles. */
interface OgMosaicFrame {
  width: number;
  height: number;
  gap: number;
}

/** Mirrors `services/collections.COVER_TILES`; a longer list is cut so a wider backend
 *  cover cannot spill out of the panel. */
const MOSAIC_MAX_TILES = 4;

/** Tile boxes for a collection's mosaic, restating `<ItemMedia>`'s arrangement (Satori
 *  lays out flex, not grid): 1 fills, 2 split, 3 put the earliest tall on the left, 4 fill
 *  2x2. Boxes are absolute; `gap` is the neutral between them. */
export function ogMosaicBoxes(count: number, frame: OgMosaicFrame): OgMosaicBox[] {
  const tiles = Math.min(Math.max(Math.trunc(count), 0), MOSAIC_MAX_TILES);
  const { width, height, gap } = frame;
  if (tiles === 0) return [];
  if (tiles === 1) return [{ left: 0, top: 0, width, height }];

  const colWidth = (width - gap) / 2;
  const rowHeight = (height - gap) / 2;
  const right = colWidth + gap;
  const bottom = rowHeight + gap;

  if (tiles === 2) {
    return [
      { left: 0, top: 0, width: colWidth, height },
      { left: right, top: 0, width: colWidth, height },
    ];
  }
  if (tiles === 3) {
    return [
      { left: 0, top: 0, width: colWidth, height },
      { left: right, top: 0, width: colWidth, height: rowHeight },
      { left: right, top: bottom, width: colWidth, height: rowHeight },
    ];
  }
  return [
    { left: 0, top: 0, width: colWidth, height: rowHeight },
    { left: right, top: 0, width: colWidth, height: rowHeight },
    { left: 0, top: bottom, width: colWidth, height: rowHeight },
    { left: right, top: bottom, width: colWidth, height: rowHeight },
  ];
}
