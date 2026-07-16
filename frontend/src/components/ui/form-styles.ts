// Form-shape class strings — labels and error banners. The field shapes
// (default / compact / locked) moved into the `<Input>` component (`./Input`);
// `FORM_INVALID_FIELD` stays here because it flags section cards too, not just
// inputs.
//
// Separate from `styles.ts` (the colour-only palette source) on purpose: form
// widgets' identity *is* their shape (padding/sizing), so it lives here.

// The bare 11px uppercase label text, for block-level hosts that can't take
// `block` themselves (a table head row, an inline heading div). FORM_LABEL is
// this plus `block`, for `<label>` elements.
export const LABEL_TEXT = "text-[11px] uppercase tracking-wider text-neutral-500";

// Standard form label — uppercase eyebrow above the input. `block` so the
// input drops below; no `mb-` — the surrounding stack owns vertical rhythm.
export const FORM_LABEL = `block ${LABEL_TEXT}`;

// Compact label: one size step down for the denser auth-card fields. No
// baked-in margin (like FORM_LABEL, the surrounding stack owns vertical
// rhythm), so its wrappers carry `space-y-1`.
export const FORM_LABEL_COMPACT =
  "block text-[10px] uppercase tracking-wider text-neutral-500";

// Red outline for a field / section flagged by `IncompleteFormNotice`. The `!`
// overrides the element's own `border-*` (inputs and section cards already carry
// one); the faint ring lifts it off the dark card. Append to the existing class.
export const FORM_INVALID_FIELD = "!border-red-500/80 ring-1 ring-red-500/30";

// Red label text for the same flagged state, on a `<label>` or a
// `SectionHeading` title rather than a bordered block. Every required field
// pairs this with FORM_INVALID_FIELD, so the label and its input always agree
// on when to turn red. Append to the existing label class.
export const FORM_INVALID_LABEL = "!text-red-400";

// The one error banner: red, above the actions. Used by every form, auth card,
// and admin panel. Earlier `_COMPACT` / `_BOXED` siblings only varied the red
// tint (dark fill vs light wash) and the density, neither of which carried a
// meaning, so they collapsed into this single look.
export const FORM_ERROR_BANNER =
  "bg-red-900/40 border border-red-700/60 text-red-300 px-4 py-3 rounded-md text-sm";

// Positive confirmation banner. Orange, not green (see design.md's palette: a
// "success" green next to red destructive actions reads wrong, so the app stays
// in the orange family). Covers success + info notices (password updated, reset
// confirmation). Same shape as FORM_ERROR_BANNER, which it replaces in the same
// slot of the same forms, so the box must not shrink when the action succeeds.
export const FORM_SUCCESS_BANNER =
  "bg-orange-500/15 border border-orange-500/30 text-orange-200 px-4 py-3 rounded-md text-sm";
