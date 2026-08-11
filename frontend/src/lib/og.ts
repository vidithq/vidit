// Pure helpers behind the generated share cards (`app/**/opengraph-image.tsx`).
// Kept out of the Satori modules so they stay testable and free of the
// `node:fs` font read those modules do at import time.

/** Equirectangular world projection, normalised to the unit square. */
export interface ProjectedPoint {
  /** 0 at 180°W, 1 at 180°E. */
  x: number;
  /** 0 at the north pole, 1 at the south pole. */
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Plate carrée projection of a coordinate onto the share card's world panel:
 * longitude spreads linearly across the width, latitude down the height. The
 * panel carries a graticule and no coastlines, so the aspect the caller draws
 * it at is a styling choice and no reprojection follows from it.
 *
 * Out-of-range values clamp to the frame rather than escaping it: the card is
 * a picture, not a validator, and a stray value must not draw a marker outside
 * the panel.
 */
export function projectEquirectangular(lat: number, lng: number): ProjectedPoint {
  return {
    x: clamp01((lng + 180) / 360),
    y: clamp01((90 - lat) / 180),
  };
}

/**
 * Shorten `text` to `max` characters, cutting on a word boundary when one sits
 * in the last quarter of the budget. Satori's line clamping is unreliable, so
 * every card truncates its own strings before layout.
 */
export function ogTruncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.75 ? cut.slice(0, lastSpace) : cut.trimEnd();
  return `${body}…`;
}

/** Thousands-separated count for the card's stat tiles. */
export function ogCount(value: number): string {
  return value.toLocaleString("en-US");
}

// Hostnames that resolve inside a private network rather than on the public
// internet. Bare names (no dot) cover `localhost` and intranet short names.
const PRIVATE_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

/**
 * True when `value` is safe for the card renderer to fetch server-side.
 *
 * `users.avatar_url` is a free-form URL its owner types, and the card renderer
 * runs on our infrastructure rather than in the reader's browser, so fetching
 * one unfiltered would turn a profile field into a server-side request forgery
 * primitive whose response is published as a public image. The guard keeps the
 * fetch to plausible public image hosts: TLS only (the cloud metadata services
 * answer over plain http), no address literals, no private-network name, and a
 * dotted hostname. Anything rejected falls back to the monogram avatar.
 */
export function isFetchableAvatarUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  // IPv6 literals arrive bracketed; IPv4 and its decimal / hex spellings have
  // no dotted-name shape, so the dot check below catches them too.
  if (host.startsWith("[")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (!host.includes(".")) return false;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}
