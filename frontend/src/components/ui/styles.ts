// Centralised colour-treatment class strings for the chip / pill / link family.
// Constants cover *only* colour (background, border, text, hover); shape stays
// at the call site. Buttons are the <Button> primitive (./Button) and pills,
// chips, and badges are the <Pill> primitive (./Pill); both bundle shape +
// colour as variants, so no *_BUTTON or *_PILL colour constants live here.

// Base accent surface paint, the single source for the accent orange fill.
// The <Pill> accent tone composes it (./Pill layers a border on top); the
// active nav / row treatments (Sidebar, landing, submit) reuse the same fill
// without a pill border, so a pill and an active nav item can't drift apart.
// The neutral grey counterpart lives inside <Pill> (its only consumer).
export const ACCENT_SURFACE = "bg-orange-500/15 text-orange-400";

// Tappable card / row — orange border on hover. Only the hover is the
// invariant; pair with whatever bg + default border the card uses.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

// Inline text link — orange label, underline on hover. The single home for
// the "clickable orange text" treatment (bylines, "Back to X", retry actions,
// empty-state CTAs). Size / weight stay at the call site.
export const TEXT_LINK = "text-orange-400 hover:underline";

// Backdrop for an icon control floating over media (a tile's download, the
// lightbox's expand and close). Media is arbitrary pixels, so a bare glyph can
// land on anything; the translucent dark plate plus blur keeps it readable over
// a white sky as well as a night frame. The colours are the player's own
// register (#f5f5f5 glyph, white hover wash, no accent), so a floating control
// next to the player reads as part of the same family rather than an
// app-accent button floating over a frame. Applied over
// <Button icon variant="ghost">: the neutral colours here override the ghost
// orange (cn resolves the conflict in the caller's favour).
export const FLOATING_CONTROL =
  "size-[38px] rounded-lg bg-black/60 text-neutral-100 hover:bg-white/20 hover:text-white backdrop-blur-sm";

// Floating media controls that stay out of the reader's way: invisible at rest,
// revealed when the pointer is over the frame (put `group` on the frame) or when
// a control inside takes keyboard focus. Tailwind gates `hover:` behind
// `(hover: hover)`, so a touch device would never reveal them at all; the
// coarse-pointer rule pins them visible there instead of locking mobile out of
// a control it cannot summon. Opacity only: the cluster's position and its
// buttons stay at the call site.
export const HOVER_REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100";

// The armed half of a two-click confirm, for a control that stays in place
// while it waits: a ring plus a neutral plate, so the button reads as changed
// without moving or resizing anything around it. One look for every armed
// control that is not the loud red point of no return (that one is
// `DANGER_CONFIRM` in ./Button): the event share row's draft-link pair, the
// detection form's Submit. Pair with `useConfirmAction`, which owns the arming
// itself; the label change stays at the call site.
export const ARMED_RING = "bg-neutral-800 ring-1 ring-neutral-500";

// Amber "caution / heads-up" surface — the warning counterpart to the red error
// banners (a hard error). Amber reads as "check this, you're not blocked"
// (duplicate-probe, curated-tags load failure, tweet-import notice). Colour only
// (border + tint + text); radius / padding / layout stay at the call site, since
// the callouts range from a one-line notice to an icon + list.
export const WARNING_CALLOUT =
  "border border-amber-500/30 bg-amber-500/10 text-amber-200";
