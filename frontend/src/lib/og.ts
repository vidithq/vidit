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
  // Cut over code points, not UTF-16 units: an emoji or any astral character is
  // a surrogate pair, and slicing through one leaves a lone surrogate that
  // renders as a replacement box on the card.
  const points = Array.from(cleaned);
  if (points.length <= max) return cleaned;
  const cut = points.slice(0, max - 1).join("");
  // A space is its own code point, so an index of one is always a safe cut.
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

  // A fully-qualified name may carry a trailing dot (`localhost.` resolves
  // exactly like `localhost`), and every check below is a suffix or shape
  // comparison, so the root label goes before any of them run.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // IPv6 literals arrive bracketed. WHATWG URL parsing normalises every IPv4
  // spelling (decimal `2130706433`, hex `0x7f000001`, short forms) to a dotted
  // quad at construction, so the one regex below covers all of them.
  if (host.startsWith("[")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (!host.includes(".")) return false;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}

/**
 * True when `address` is not a public unicast address the card renderer may
 * connect to. Both families, and an unparsable value counts as unsafe.
 *
 * `isFetchableAvatarUrl` reads the name; this reads what the name resolved to,
 * which is the half a name check cannot cover: `169.254.169.254.nip.io` is a
 * public dotted hostname whose A record is the cloud metadata address, and any
 * host an owner controls can point at one. `_og/data.ts` wires it into the
 * avatar connection so the block lands before the socket opens.
 *
 * Rejected, v4: `0.0.0.0/8` (unspecified), `10/8`, `100.64/10` (CGNAT),
 * `127/8` (loopback), `169.254/16` (link-local, the metadata services),
 * `172.16/12`, `192.168/16`, and `224/4` upward (multicast, reserved,
 * broadcast). v6: `::` (unspecified), `::1` (loopback), `fc00::/7` (unique
 * local), `fe80::/10` (link-local), `ff00::/8` (multicast), plus any
 * IPv4-mapped form (`::ffff:127.0.0.1` and its hex spelling), which is checked
 * against the v4 list above.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return true;
  // A zone index (`fe80::1%eth0`) is routing detail, not part of the address.
  const bare = value.split("%")[0];
  return bare.includes(":") ? isPrivateIpv6(bare) : isPrivateIpv4(bare);
}

/** Dotted-quad octets, or `null` when `address` is not one. */
function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return null;
  return octets;
}

function isPrivateIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return true;
  const [a, b] = octets;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

/** The eight 16-bit groups of an IPv6 address, or `null` when it is not one. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isPrivateIpv6(address: string): boolean {
  // `::ffff:127.0.0.1`: the dotted tail is a v4 address wearing a v6 spelling.
  const dotted = address.lastIndexOf(":");
  const tail = address.slice(dotted + 1);
  if (tail.includes(".")) {
    const head = ipv6Groups(`${address.slice(0, dotted + 1)}0`);
    return head === null || isPrivateIpv4(tail);
  }
  const groups = ipv6Groups(address);
  if (!groups) return true;
  // The hex spelling of the same mapped form: `::ffff:7f00:1`.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [, , , , , , g6, g7] = groups;
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join("."));
  }
  if (groups.every((g) => g === 0)) return true;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xff00) === 0xff00) return true;
  return false;
}
