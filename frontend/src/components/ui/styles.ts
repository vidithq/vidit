// Centralised colour-treatment class strings for the chip / pill / link family.
// Constants cover *only* colour (background, border, text, hover); shape stays
// at the call site. Buttons are the <Button> primitive (./Button) and pills,
// chips, and badges are the <Pill> primitive (./Pill); both bundle shape +
// colour as variants, so no *_BUTTON or *_PILL colour constants live here.

// Base surface paints, the single source for the accent orange and neutral
// grey. The <Pill> tones compose these (./Pill layers a border per tone); the
// active nav / row treatments (Sidebar, landing, submit) reuse the same fill
// without a pill border, so a pill and an active nav item can't drift apart.
export const NEUTRAL_SURFACE = "bg-neutral-800 text-neutral-400";
export const ACCENT_SURFACE = "bg-orange-500/15 text-orange-400";

// Tappable card / row — orange border on hover. Only the hover is the
// invariant; pair with whatever bg + default border the card uses.
export const TAPPABLE_HOVER = "hover:border-orange-500/40 transition-colors";

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
