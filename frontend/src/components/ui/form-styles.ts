// Form-shape class strings — labels, inputs, error banners.
//
// Separate from `styles.ts` (the colour-only palette source) on purpose: form
// widgets' identity *is* their shape (padding/sizing), so it lives here.
// Each comes in a default (main-app forms) and a denser `_COMPACT` variant
// (auth cards, admin rows, profile trust-toggle panel).

// Standard form label — uppercase eyebrow above the input. `block` so the
// input drops below; no `mb-` — the surrounding stack owns vertical rhythm.
export const FORM_LABEL =
  "block text-[11px] uppercase tracking-wider text-neutral-500";

// Compact label — built-in `mb-1` for the tighter auth-card rhythm.
export const FORM_LABEL_COMPACT =
  "block text-[10px] uppercase tracking-wider text-neutral-500 mb-1";

export const FORM_INPUT =
  "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-hidden focus:border-orange-500";

// Compact input — dimmer, no focus ring, for display-leaning fields that read
// as part of a data row (admin invite-code rows, profile trust-reason editor).
export const FORM_INPUT_COMPACT =
  "w-full px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-300";

// Locked variant of `FORM_INPUT` — same padding so the field doesn't shift,
// darker background to read as read-only. `cursor-not-allowed` baked in.
export const FORM_INPUT_LOCKED =
  "w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-400 text-sm cursor-not-allowed";

export const FORM_ERROR_BANNER =
  "bg-red-900/40 border border-red-700/60 text-red-300 px-4 py-3 rounded-md text-sm";

export const FORM_ERROR_BANNER_COMPACT =
  "bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 rounded-sm text-xs";

// Boxed inline error — admin panels. Lighter red than `FORM_ERROR_BANNER`, for
// a panel-level action error that sits inside a card rather than under a form
// field. (The form banners use `red-900/40`; this card variant uses `red-500/10`.)
export const FORM_ERROR_BANNER_BOXED =
  "bg-red-500/10 border border-red-500/30 text-red-300 px-3 py-2 rounded-md text-xs";
