// Pointer-type read for behaviour CSS handles with the `pointer-coarse:` variant (see
// `HOVER_REVEAL` in components/ui/styles.ts), for rules a stylesheet cannot express (hit-test
// padding, hover previews, outside-tap rings).

const COARSE_QUERY = "(pointer: coarse)";

// Latched on first read, unlike the live CSS variant: callers hit-test, and a value flipping
// between `pointerdown` and `click` would pad half a tap. A mouse user after a finger keeps
// the wider box until reload.
let coarse: boolean | null = null;

/** True when the primary pointer is coarse (a finger); false on mouse/trackpad and where
 *  `matchMedia` is unavailable (SSR, jsdom), where exact hit testing is the safe answer. */
export function isCoarsePointer(): boolean {
  if (coarse === null) {
    coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(COARSE_QUERY).matches;
  }
  return coarse;
}
