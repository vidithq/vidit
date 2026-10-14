// Colour-treatment class strings for the chip / pill / link family. Colour only
// (background, border, text, hover); shape stays at the call site. <Button> and
// <Pill> bundle shape + colour as variants, so no *_BUTTON or *_PILL constants
// live here.

// Base accent fill. <Pill>'s accent tone composes it; active nav / row
// treatments reuse it, so a pill and an active nav item can't drift apart.
export const ACCENT_SURFACE = "bg-orange-500/15 text-orange-400";

// The accent as a five-step intensity ramp, strongest first, shared by every
// chart: <SourceHostBar> uses all five, <ActivityHeatmap> the four strongest
// (the faintest reads too close to an empty cell). Single hue on purpose: the
// app has one accent and both charts order by magnitude.
//
// The ramp is the one sanctioned inert accent (elsewhere accent means
// clickable): a mark whose step encodes magnitude carries it, and so does its
// legend. What stands outside the ranking takes CHART_TAIL or CHART_NEUTRAL.
export const ACCENT_RAMP = [
  "bg-orange-500",
  "bg-orange-500/75",
  "bg-orange-500/50",
  "bg-orange-500/30",
  "bg-orange-500/15",
] as const;

// Counterparts to the ramp. `CHART_TAIL` is a bucket holding real work under no
// printed name (<SourceHostBar>'s "Other"). `CHART_NEUTRAL` is absence (a month
// with no event, events naming no source). Both read against the
// `bg-neutral-900` <Card>.
export const CHART_TAIL = "bg-neutral-500";
export const CHART_NEUTRAL = "bg-neutral-800";

// Tappable card / row: orange border on hover. Pair with the card's own bg and
// default border.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

// Inline text link: orange label, underline on hover. Size and weight stay at
// the call site.
export const TEXT_LINK = "text-orange-400 hover:underline";

// Backdrop for an icon control floating over media (a tile's download, the
// lightbox's expand and close). The translucent dark plate plus blur stays
// readable over any frame, in the player's own colours (no accent). Apply over
// <Button icon variant="ghost">; `cn` resolves the conflict in the caller's
// favour.
export const FLOATING_CONTROL =
  "size-[38px] rounded-lg bg-black/60 text-neutral-100 hover:bg-white/20 hover:text-white backdrop-blur-sm";

// Invisible at rest, revealed on pointer over the frame (put `group` on it) or
// keyboard focus inside. Tailwind gates `hover:` behind `(hover: hover)`, so the
// coarse-pointer rule pins them visible on touch. Opacity only.
export const HOVER_REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100";

// The armed half of a two-click confirm for a control that stays in place: a
// ring plus a neutral plate. For every armed control except the loud red point
// of no return (`DANGER_CONFIRM` in ./Button). Pair with `useConfirmAction`.
export const ARMED_RING = "bg-neutral-800 ring-1 ring-neutral-500";

// Amber "check this, you're not blocked" surface, the warning counterpart to the
// red error banners. Colour only; radius, padding and layout stay at the call
// site.
export const WARNING_CALLOUT =
  "border border-amber-500/30 bg-amber-500/10 text-amber-200";
