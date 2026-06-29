// Centralised orange-palette class strings.
//
// Constants cover *only* colour treatment (background, border, text, hover).
// Shape — padding, font size, width, layout, `disabled:opacity-50` — stays at
// the call site, since CTAs have legitimately different shapes (full-width
// auth submits, compact icon buttons in bounty headers, etc.).

// Primary action button — soft-fill outlined orange. Reserved for the
// "do this thing now" buttons: Submit, Post a bounty, auth submits, etc.
export const PRIMARY_BUTTON =
  "bg-orange-500/10 text-orange-400 border border-orange-500/40 " +
  "hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-300 " +
  "transition-colors";

// Filter / tag chip in its selected state — tinted orange.
// Pair with `FILTER_CHIP_INACTIVE` via a ternary.
export const FILTER_CHIP_ACTIVE = "bg-orange-500/15 text-orange-400";

// Filter / tag chip in its inactive state — neutral with a darker hover.
export const FILTER_CHIP_INACTIVE =
  "bg-neutral-800 text-neutral-400 hover:bg-neutral-700";

// Tappable card / row — orange border on hover. Only the hover is the
// invariant; pair with whatever bg + default border the card uses.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

// Non-interactive status badge, three-state set used together on bounty pills:
// open (orange — actionable), fulfilled (neutral white — completed; avoid green
// so it doesn't read as celebratory next to red destructive actions), closed
// (neutral grey — withdrawn / archived).
export const STATUS_PILL_ACTIVE =
  "bg-orange-500/15 text-orange-400 border border-orange-500/30";
export const STATUS_PILL_FULFILLED =
  "bg-neutral-100/10 text-neutral-100 border border-neutral-100/20";
export const STATUS_PILL_CLOSED =
  "bg-neutral-800 text-neutral-400 border border-neutral-700";

// Closed-beta / system-info pill — fixed banner element. Less-saturated
// background than the status pill so it doesn't compete with the active state.
// `pointer-events-none` is the caller's responsibility.
export const BETA_PILL =
  "bg-orange-500/10 text-orange-400 border border-orange-500/30";

// Decorative (non-clickable) tag chip. Neutral, not orange: with several tags
// per card, orange tags competed with the orange CTAs / status pills / links,
// and tags carry meta info, not signal.
export const TAG_CHIP = "bg-neutral-800 text-neutral-400";

// Inline text link — orange label, underline on hover. The single home for
// the "clickable orange text" treatment (bylines, "Back to X", retry actions,
// empty-state CTAs). Size / weight stay at the call site.
export const TEXT_LINK = "text-orange-400 hover:underline";
