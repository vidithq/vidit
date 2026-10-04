// Form-shape class strings: labels and error banners. Field shapes live in
// `<Input>`; `FORM_INVALID_FIELD` stays here because it flags section cards too.
// Separate from `styles.ts` (colour-only) because a form widget's identity is its
// shape.

// The bare 11px uppercase label, for hosts that can't take `block` (a table head
// row, an inline heading div). FORM_LABEL is this plus `block`.
export const LABEL_TEXT = "text-[11px] uppercase tracking-wider text-neutral-500";

// Standard form label: uppercase eyebrow above the input. No `mb-`: the
// surrounding stack owns vertical rhythm.
export const FORM_LABEL = `block ${LABEL_TEXT}`;

// One size step down, for the denser auth-card fields. No margin (wrappers carry
// `space-y-1`).
export const FORM_LABEL_COMPACT =
  "block text-[10px] uppercase tracking-wider text-neutral-500";

// Red outline for a field or section flagged by `IncompleteFormNotice`. The `!`
// overrides the element's own `border-*`; the ring lifts it off the dark card.
// Append to the existing class.
export const FORM_INVALID_FIELD = "!border-red-500/80 ring-1 ring-red-500/30";

// Red label text for the same state, so a label and its input turn red together.
// Append to the existing label class.
export const FORM_INVALID_LABEL = "!text-red-400";

// The one error banner, used by every form, auth card and admin panel.
export const FORM_ERROR_BANNER =
  "bg-red-900/40 border border-red-700/60 text-red-300 px-4 py-3 rounded-md text-sm";

// Positive confirmation (success and info notices). Orange, not green: a green
// next to red destructive actions reads wrong (see design.md's palette). Same
// shape as FORM_ERROR_BANNER, so the box doesn't shrink on success.
export const FORM_SUCCESS_BANNER =
  "bg-orange-500/15 border border-orange-500/30 text-orange-200 px-4 py-3 rounded-md text-sm";
