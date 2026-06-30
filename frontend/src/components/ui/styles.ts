// Centralised colour-treatment class strings for the chip / pill / link family.
// Constants cover *only* colour (background, border, text, hover); shape stays
// at the call site. Buttons are the <Button> primitive (./Button), which bundles
// shape + colour as variants, so no *_BUTTON colour constants live here.

// Base surface paints shared across the chip / pill family: the bg + text core,
// with border / hover layered on by each named role below. One home for the
// paint, so the neutral grey and the accent orange can't drift between a tag, a
// filter chip, and a status pill.
const NEUTRAL_SURFACE = "bg-neutral-800 text-neutral-400";
const ACCENT_SURFACE = "bg-orange-500/15 text-orange-400";

// Filter / tag chip selected state: the accent surface. Pair with
// FILTER_CHIP_INACTIVE via a ternary.
export const FILTER_CHIP_ACTIVE = ACCENT_SURFACE;

// Filter / tag chip inactive state: the neutral surface with a darker hover.
export const FILTER_CHIP_INACTIVE = `${NEUTRAL_SURFACE} hover:bg-neutral-700`;

// Tappable card / row — orange border on hover. Only the hover is the
// invariant; pair with whatever bg + default border the card uses.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

// Non-interactive status badge, three-state set used together on bounty pills:
// open (orange — actionable), fulfilled (neutral white — completed; avoid green
// so it doesn't read as celebratory next to red destructive actions), closed
// (neutral grey — withdrawn / archived).
export const STATUS_PILL_ACTIVE = `${ACCENT_SURFACE} border border-orange-500/30`;
export const STATUS_PILL_FULFILLED =
  "bg-neutral-100/10 text-neutral-100 border border-neutral-100/20";
export const STATUS_PILL_CLOSED = `${NEUTRAL_SURFACE} border border-neutral-700`;

// Closed-beta / system-info pill — fixed banner element. Less-saturated
// background than the status pill so it doesn't compete with the active state.
// `pointer-events-none` is the caller's responsibility.
export const BETA_PILL =
  "bg-orange-500/10 text-orange-400 border border-orange-500/30";

// Decorative (non-clickable) tag chip. Neutral, not orange: with several tags
// per card, orange tags competed with the orange CTAs / status pills / links,
// and tags carry meta info, not signal.
export const TAG_CHIP = NEUTRAL_SURFACE;

// Inline text link — orange label, underline on hover. The single home for
// the "clickable orange text" treatment (bylines, "Back to X", retry actions,
// empty-state CTAs). Size / weight stay at the call site.
export const TEXT_LINK = "text-orange-400 hover:underline";

// Amber "caution / heads-up" surface — the warning counterpart to the red error
// banners (a hard error). Amber reads as "check this, you're not blocked"
// (duplicate-probe, curated-tags load failure, tweet-import notice). Colour only
// (border + tint + text); radius / padding / layout stay at the call site, since
// the callouts range from a one-line notice to an icon + list.
export const WARNING_CALLOUT =
  "border border-amber-500/30 bg-amber-500/10 text-amber-200";
