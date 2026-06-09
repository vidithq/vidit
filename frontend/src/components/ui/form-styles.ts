// Form-shape class strings — labels, inputs, error banners.
//
// Lives alongside `styles.ts` but stays separate on purpose: `styles.ts`
// is the orange-palette source of truth and intentionally covers only
// colour treatment (no padding / sizing / shape). Form widgets, by
// contrast, are visual primitives whose entire identity *is* their
// shape — the label-eyebrow + bordered-input pair has only one correct
// appearance across the app, so re-declaring the same Tailwind string
// in eight files just leaks margin/size drift on the next theme tweak.
//
// Two flavours of each: a default (used on main-app forms — submit a
// geolocation, post a bounty, edit settings) and a `_COMPACT` variant
// (used inside the smaller `(auth)` cards, admin rows, and the
// trust-toggle panel on profiles). The split is intentional — the
// compact set is one notch denser, not a coincidence.

// Standard form label — uppercase eyebrow above the input. `block` so
// the input drops below; no `mb-` because the surrounding stack already
// owns vertical rhythm.
export const FORM_LABEL =
  "block text-[11px] uppercase tracking-wider text-neutral-500";

// Compact label — smaller font and a built-in `mb-1` for the auth card
// surfaces that have a tighter vertical rhythm.
export const FORM_LABEL_COMPACT =
  "block text-[10px] uppercase tracking-wider text-neutral-500 mb-1";

// Standard input — full-width, bordered, with the orange focus ring
// matching the palette in `styles.ts`. Used on every input the analyst
// is expected to *type into*: auth forms, settings, submit forms.
export const FORM_INPUT =
  "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-hidden focus:border-orange-500";

// Compact input — slightly less padding, dimmer text, no focus ring.
// Used on display-leaning inputs (admin invite-code rows, profile
// trust-reason editor) where the field is technically editable but
// reads as part of a data row, not a primary form control.
export const FORM_INPUT_COMPACT =
  "w-full px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-300";

// Locked variant of `FORM_INPUT` — same padding so the field doesn't
// visually shift, darker background to read as read-only. Pair with
// `readOnly` and `cursor-not-allowed` already baked in. Used by the
// geolocation submit form when the source URL is locked to a bounty
// fulfilment context.
export const FORM_INPUT_LOCKED =
  "w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-400 text-sm cursor-not-allowed";

// Standard error banner — sits above the form submit, more prominent
// than the compact variant.
export const FORM_ERROR_BANNER =
  "bg-red-900/40 border border-red-700/60 text-red-300 px-4 py-3 rounded-md text-sm";

// Compact error banner — auth cards and tight panels.
export const FORM_ERROR_BANNER_COMPACT =
  "bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 rounded-sm text-xs";
