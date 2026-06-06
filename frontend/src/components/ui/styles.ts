// Centralised orange-palette class strings.
//
// The codebase had ~20 duplicates of the same long Tailwind class strings —
// every CTA repeating the soft-fill outlined-orange treatment, every filter
// chip repeating the tinted-vs-neutral pair. Pulling them here means the
// next palette tweak edits one place instead of grepping.
//
// Constants intentionally cover *only* the colour treatment (background,
// border, text, hover). Shape — padding, font size, width, layout, the
// `disabled:opacity-50` modifier where applicable — stays at the call site,
// since CTAs in the codebase have legitimately different shapes (full-width
// auth submits, compact icon buttons in bounty headers, etc.).

// Primary action button — soft-fill outlined orange. Reserved for the
// "do this thing now" buttons: Submit, Post a bounty, Geolocate this,
// Update password, all auth form submits, admin actions, etc.
//
// Usage:
//   <button className={`px-3 py-1.5 rounded-md text-sm disabled:opacity-50 ${PRIMARY_BUTTON}`}>
//     Submit
//   </button>
export const PRIMARY_BUTTON =
  "bg-orange-500/10 text-orange-400 border border-orange-500/40 " +
  "hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-300 " +
  "transition-colors";

// Filter / tag chip in its selected state — tinted orange.
// Pair with `FILTER_CHIP_INACTIVE` via a ternary.
//
// Usage:
//   <button
//     className={`px-2 py-0.5 rounded-full text-[11px] ${
//       active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE
//     }`}
//   >
//     {tag}
//   </button>
export const FILTER_CHIP_ACTIVE = "bg-orange-500/15 text-orange-400";

// Filter / tag chip in its inactive state — neutral with a darker hover.
export const FILTER_CHIP_INACTIVE =
  "bg-neutral-800 text-neutral-400 hover:bg-neutral-700";

// Tappable card / row — bring the border to orange on hover. Pair with
// whatever bg + default border the card uses (varies across the codebase:
// `bg-neutral-900 border-neutral-800` for outer cards, `bg-neutral-800
// border-neutral-700` for inner rows). The hover treatment is the
// invariant — that's all this constant is.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

// Status badge in the "open" / "active" / "in-progress" state — same tint
// as a selected filter chip plus a subtle border, used inline next to
// content as a state indicator (bounty status pill, "open" admin row,
// etc). Non-interactive.
//
// Three-state set: open (orange — actionable), fulfilled (neutral white —
// completed, not "success"; we deliberately avoid green so fulfilled
// doesn't read as celebratory next to red destructive actions), closed
// (neutral grey — withdrawn / archived). Used together on bounty pills.
export const STATUS_PILL_ACTIVE =
  "bg-orange-500/15 text-orange-400 border border-orange-500/30";
export const STATUS_PILL_FULFILLED =
  "bg-neutral-100/10 text-neutral-100 border border-neutral-100/20";
export const STATUS_PILL_CLOSED =
  "bg-neutral-800 text-neutral-400 border border-neutral-700";

// Closed-beta / system-info pill — sits as a fixed banner element. Same
// tonal family as the status pill but uses a less-saturated background
// because it's purely decorative and shouldn't compete with the active
// state. `pointer-events-none` is the caller's responsibility — most
// usages pin this in a corner and rely on the absence of interactivity.
export const BETA_PILL =
  "bg-orange-500/10 text-orange-400 border border-orange-500/30";

// Decorative tag chip — non-clickable display chip for tags on detail
// pages, list cards, search results. Neutral instead of the previous
// `bg-orange-950 text-orange-400` because cards with several tags each
// got visually dense — orange tags on every row competed with the
// orange CTAs / orange status pills / orange links. Tags carry meta
// info, not signal, so neutral is the right tonal weight. Same paint
// as `FILTER_CHIP_INACTIVE` minus the hover (decorative ≠ clickable).
export const TAG_CHIP = "bg-neutral-800 text-neutral-400";
