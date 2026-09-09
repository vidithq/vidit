// The pointer-type read for behaviour that CSS handles with the
// `pointer-coarse:` variant (see `HOVER_REVEAL` in components/ui/styles.ts):
// same media feature, same meaning, for the rules a stylesheet cannot express
// (hit-test padding on the map canvas, a hover preview that must not arm, a
// ring that closes on an outside tap).

const COARSE_QUERY = "(pointer: coarse)";

// Read once and kept: the primary pointing device does not change under a
// session, and the map queries this on every tap.
let coarse: boolean | null = null;

/** True when the primary pointing device is coarse (a finger), false on a
 *  mouse or trackpad and anywhere `matchMedia` is out of reach (SSR, jsdom):
 *  the exact hit testing is the safe answer for an unknown pointer. */
export function isCoarsePointer(): boolean {
  if (coarse === null) {
    coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(COARSE_QUERY).matches;
  }
  return coarse;
}
