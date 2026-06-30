// Form-shape class strings — labels and error banners. The field shapes
// (default / compact / locked) moved into the `<Input>` component (`./Input`);
// `FORM_INVALID_FIELD` stays here because it flags section cards too, not just
// inputs.
//
// Separate from `styles.ts` (the colour-only palette source) on purpose: form
// widgets' identity *is* their shape (padding/sizing), so it lives here.

// Standard form label — uppercase eyebrow above the input. `block` so the
// input drops below; no `mb-` — the surrounding stack owns vertical rhythm.
export const FORM_LABEL =
  "block text-[11px] uppercase tracking-wider text-neutral-500";

// Compact label — built-in `mb-1` for the tighter auth-card rhythm.
export const FORM_LABEL_COMPACT =
  "block text-[10px] uppercase tracking-wider text-neutral-500 mb-1";

// Red outline for a field / section flagged by `IncompleteFormNotice`. The `!`
// overrides the element's own `border-*` (inputs and section cards already carry
// one); the faint ring lifts it off the dark card. Append to the existing class.
export const FORM_INVALID_FIELD = "!border-red-500/80 ring-1 ring-red-500/30";

// The one error banner: red, above the actions. Used by every form, auth card,
// and admin panel. Earlier `_COMPACT` / `_BOXED` siblings only varied the red
// tint (dark fill vs light wash) and the density, neither of which carried a
// meaning, so they collapsed into this single look.
export const FORM_ERROR_BANNER =
  "bg-red-900/40 border border-red-700/60 text-red-300 px-4 py-3 rounded-md text-sm";

// Positive confirmation banner. Orange, not green (see design.md's palette: a
// "success" green next to red destructive actions reads wrong, so the app stays
// in the orange family). Covers success + info notices (password updated, reset
// confirmation). Sibling to the FORM_ERROR_BANNER family.
export const FORM_SUCCESS_BANNER =
  "bg-orange-500/15 border border-orange-500/30 text-orange-200 px-3 py-2 rounded-sm text-xs";
