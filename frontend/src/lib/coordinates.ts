// The coordinate vocabulary the forms and the read surfaces share: the bounds,
// the strict field parse, the paste parser behind the latitude / longitude
// inputs, the 6-decimal rendering, and the external map link.
//
// Bounds mirror the backend range check in services/events.py
// (validate_coordinates), so the submit-form validation reads against a single
// source instead of bare magic numbers.
export const LAT_MIN = -90;
export const LAT_MAX = 90;
export const LNG_MIN = -180;
export const LNG_MAX = 180;

export interface CoordinatePair {
  lat: number;
  lng: number;
}

/** Parse a whole string as a finite number, or `null`. Unlike `parseFloat`,
 *  this rejects partially-numeric input (`"50.1abc"`), so a malformed pair
 *  clears the coordinates rather than storing a truncated value. Blank /
 *  whitespace-only reads as absent (`null`), preserving both-or-neither. */
export function cleanNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function inBounds(lat: number, lng: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
}

/** The pair a coordinate input pair currently holds, or `null` while it is
 *  empty, half-typed, malformed, or out of bounds. The affordances that only
 *  make sense on a real point (the map link, the copy button) gate on it. */
export function coordinatePair(
  latValue: string,
  lngValue: string
): CoordinatePair | null {
  const lat = cleanNumber(latValue);
  const lng = cleanNumber(lngValue);
  if (lat === null || lng === null || !inBounds(lat, lng)) return null;
  return { lat, lng };
}

// A signed decimal degree. Capped at 3 integer digits so a timestamp or an id
// pasted next to a comma can't read as a coordinate.
const DECIMAL = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

// "48.015883, 37.802411", "48.015883 37.802411", "48.015883°, 37.802411°":
// the whole paste is the pair, so an anchored match keeps a longer text
// (a proof paragraph that happens to contain a coordinate) out.
//
// A comma is a separator here, never a decimal mark: "48,015" fills the fields
// with 48 and 15, not the single European-notation value 48.015. Unresolvable
// without guessing, and a whole-degree pair is the likelier paste; both fields
// visibly change, so a wrong read is one the analyst sees.
const PLAIN_PAIR = new RegExp(
  String.raw`^\s*(${DECIMAL})\s*°?\s*(?:,\s*|\s+)(${DECIMAL})\s*°?\s*$`
);

// Gate for the two URL forms below: they match mid-string (a map URL carries
// its pair inside a longer path), which would otherwise let prose containing
// "@48.5,37.8" or "q=48.5,37.8" hijack an ordinary paste.
const IS_URL = /^https?:\/\//i;

// Google Maps `?q=lat,lng` / `?query=lat,lng` (the share and the place-search
// forms), comma or percent-encoded comma.
const MAPS_QUERY = new RegExp(
  String.raw`[?&](?:q|query)=(${DECIMAL})(?:,|%2C)(${DECIMAL})`,
  "i"
);

// Google Maps `@lat,lng,17z`: the viewport centre a copied map URL carries.
const MAPS_CENTER = new RegExp(String.raw`@(${DECIMAL}),(${DECIMAL})`);

/**
 * Read a "lat, lng" pair out of pasted text: a bare decimal pair, or a Google
 * Maps URL when the paste is a URL and nothing else. `null` means "not a
 * coordinate", and the caller lets the paste land as ordinary text.
 * Out-of-bounds values are rejected here rather than filling the fields with
 * something the submit floor would reject anyway.
 */
export function parsePastedCoordinates(text: string): CoordinatePair | null {
  const trimmed = text.trim();
  const match = IS_URL.test(trimmed)
    ? (MAPS_QUERY.exec(trimmed) ?? MAPS_CENTER.exec(trimmed))
    : PLAIN_PAIR.exec(trimmed);
  if (match === null) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inBounds(lat, lng)) return null;
  return { lat, lng };
}

/** The one coordinate rendering: 6 decimals, comma-separated. What the detail
 *  page shows, and what the copy button puts on the clipboard, so a copied
 *  pair pastes straight back into the inputs. */
export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/** External map link for a point, for eyeballing a coordinate against
 *  satellite imagery. Opens in a new tab at the call site. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
