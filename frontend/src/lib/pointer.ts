// The pointer-type read for behaviour that CSS handles with the
// `pointer-coarse:` variant (see `HOVER_REVEAL` in components/ui/styles.ts):
// same media feature, same meaning, for the rules a stylesheet cannot express
// (hit-test padding on the map canvas, a hover preview that must not arm, a
// ring that closes on an outside tap).

const COARSE_QUERY = "(pointer: coarse)";

// Latched on the first read and kept for the rest of the session. The CSS
// variant re-evaluates live; this deliberately does not, because its callers
// hit-test: a value that flipped between a gesture's `pointerdown` and its
// `click` would pad one half of a tap and not the other, so a stable answer
// beats a current one. A user who switches from a finger to a mouse mid-session
// keeps the finger's slop until the page reloads, which costs a mouse a wider
// box and nothing else.
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
