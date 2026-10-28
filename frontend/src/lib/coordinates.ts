// Coordinate vocabulary shared by forms and read surfaces: bounds, strict parse, paste parser,
// 6-decimal rendering, external map link.
//
// Bounds mirror the backend range check `services/events/coordinates.validate_coordinates`.
export const LAT_MIN = -90;
export const LAT_MAX = 90;
export const LNG_MIN = -180;
export const LNG_MAX = 180;

export interface CoordinatePair {
  lat: number;
  lng: number;
}

/** Parse a whole string as a finite number, or `null`. Unlike `parseFloat` it rejects
 *  `"50.1abc"`; blank reads as absent, preserving both-or-neither. */
export function cleanNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function inBounds(lat: number, lng: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
}

/** The pair two inputs hold, or `null` while empty, half-typed, malformed or out of bounds. */
export function coordinatePair(
  latValue: string,
  lngValue: string
): CoordinatePair | null {
  const lat = cleanNumber(latValue);
  const lng = cleanNumber(lngValue);
  if (lat === null || lng === null || !inBounds(lat, lng)) return null;
  return { lat, lng };
}

// Signed decimal degree, at most 3 integer digits so a pasted timestamp or id can't read as one.
const DECIMAL = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

// "48.015883, 37.802411" (space-separated and a trailing ° also pass). Anchored so a longer
// text containing a coordinate stays out.
//
// A comma is always a separator, never a decimal mark: "48,015" fills 48 and 15. A
// whole-degree pair is the likelier paste, and both fields visibly change.
const PLAIN_PAIR = new RegExp(
  String.raw`^\s*(${DECIMAL})\s*°?\s*(?:,\s*|\s+)(${DECIMAL})\s*°?\s*$`
);

// Gate for the URL forms below, which match mid-string and would let prose containing
// "@48.5,37.8" hijack a paste.
const IS_URL = /^https?:\/\//i;

// Google Maps `?q=` / `?query=` (comma or %2C).
const MAPS_QUERY = new RegExp(
  String.raw`[?&](?:q|query)=(${DECIMAL})(?:,|%2C)(${DECIMAL})`,
  "i"
);

// Google Maps `@lat,lng,17z`: the viewport centre a copied map URL carries.
const MAPS_CENTER = new RegExp(String.raw`@(${DECIMAL}),(${DECIMAL})`);

// The numbers of a bare pair, or of a Google Maps URL when the text is only a URL; bounds unchecked.
function matchPair(text: string): CoordinatePair | null {
  const trimmed = text.trim();
  const match = IS_URL.test(trimmed)
    ? (MAPS_QUERY.exec(trimmed) ?? MAPS_CENTER.exec(trimmed))
    : PLAIN_PAIR.exec(trimmed);
  if (match === null) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Read a "lat, lng" pair from pasted text: a bare decimal pair, or a Google Maps URL when the
 * paste is only a URL. `null` lets the paste land as text. Out-of-bounds values are rejected.
 */
export function parsePastedCoordinates(text: string): CoordinatePair | null {
  const pair = matchPair(text);
  return pair !== null && inBounds(pair.lat, pair.lng) ? pair : null;
}

/** Read a typed pair, in the forms a paste takes, or say why it is not one. The bound sentences
 *  are the backend's. */
export function readCoordinates(text: string): { pair: CoordinatePair } | { error: string } {
  if (text.trim() === "") return { error: "Type a latitude and a longitude." };
  const pair = matchPair(text);
  if (pair === null) {
    return {
      error: "Type the latitude, a comma, then the longitude, in decimal degrees: 48.015883, 37.802411.",
    };
  }
  const { lat, lng } = pair;
  if (lat < LAT_MIN || lat > LAT_MAX) {
    const swapped = inBounds(lng, lat) ? " The latitude comes first." : "";
    return { error: `Latitude must be between ${LAT_MIN} and ${LAT_MAX}.${swapped}` };
  }
  if (lng < LNG_MIN || lng > LNG_MAX) {
    return { error: `Longitude must be between ${LNG_MIN} and ${LNG_MAX}.` };
  }
  return { pair };
}

/** The one coordinate rendering, shared by the detail page and the copy button so a copied
 *  pair pastes back into the inputs. A narrow row passes fewer `decimals`; the copy keeps 6. */
export function formatCoordinates(lat: number, lng: number, decimals = 6): string {
  return `${lat.toFixed(decimals)}, ${lng.toFixed(decimals)}`;
}

/** The least zoom a typed coordinate lands at on the map, where roads and buildings read. */
export const GO_TO_ZOOM = 14;

/** External map link for checking a point against satellite imagery. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
