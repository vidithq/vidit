import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { ACCENT_SURFACE } from "./styles";

// The one pill for the whole status / tag / chip family: a single rounded-full
// shape at one size, the colour picked by `tone`. Static `<span>` by default;
// pass `onClick` and it becomes an interactive chip (a `<button>` with a hover)
// for filter / selection toggles. The tones mirror the button tones so the two
// languages line up:
//   accent     active / open / detected / selected (filled accent)
//   secondary  accent outline, no fill: a softer marked state than filled
//              accent (mirrors the secondary button)
//   neutral    default / tag / closed / inactive
//   danger     a revoked / error state
export type PillTone = "accent" | "secondary" | "neutral" | "danger";

// `max-w-full` plus `break-words`: a pill never outgrows the box it sits in.
// `shrink-0` holds a pill's width against its neighbours on a row, which is
// what keeps a badge from being squeezed, and it also means a pill carrying a
// long single word (a tag name on the request card's 150px content column at
// 320px) would hold its full width and run past the card. The cap bounds the
// box at the container and the break rule lets the word wrap inside it, so the
// pill takes a second line rather than the card taking a horizontal scrollbar.
// Every pill short enough to fit is untouched.
const BASE =
  "inline-flex items-center gap-1 shrink-0 max-w-full break-words rounded-full px-2 py-0.5 text-[11px] font-medium";

// The accent tone is the base surface paint (../ui/styles, the single source
// shared with the active-nav treatments) plus the pill's own border. The other
// tones have no nav counterpart, so they carry their full paint here. Internal
// on purpose: the tones are only reachable through `<Pill tone>`, so a pill
// look can't be recomposed on bespoke markup.
const PILL_TONE: Record<PillTone, string> = {
  accent: `${ACCENT_SURFACE} border border-orange-500/30`,
  secondary: "text-orange-400 border border-orange-500/40",
  neutral: "bg-neutral-800 text-neutral-400 border border-neutral-700",
  danger: "bg-red-500/10 text-red-300 border border-red-500/30",
};

interface PillProps {
  tone?: PillTone;
  icon?: ReactNode;
  title?: string;
  /** Orthogonal extras (margins, tracking, casing). Conflicting utilities
   *  resolve caller-wins via `cn`, but the pill stays one size by design. */
  className?: string;
  children: ReactNode;
  /** When set, the pill is an interactive chip: a `<button>` that brightens on
   *  hover. The caller drives the tone off its active state. */
  onClick?: () => void;
}

export function Pill({
  tone = "neutral",
  icon,
  title,
  className = "",
  children,
  onClick,
}: PillProps) {
  // An interactive chip takes the phone tap step `<Button>` takes. The resting
  // pill stands about 19px, which is a label's height and a thumb's near miss,
  // and with `onClick` it is the chip every filter surface is built out of: the
  // conflict, capture-source, tag and status buckets, the removable active
  // filters, the search scope, the author suggestions, every `<TagPicker>`
  // chip. A static pill is a label and keeps the resting height, so a row of
  // status badges reads as tight as it does now.
  const cls = cn(
    BASE,
    PILL_TONE[tone],
    onClick && `${TAP_STEP} transition-colors hover:brightness-110 cursor-pointer`,
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={cls}>
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={cls}>
      {icon}
      {children}
    </span>
  );
}
