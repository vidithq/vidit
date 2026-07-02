import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ACCENT_SURFACE, NEUTRAL_SURFACE } from "./styles";

// The one pill for the whole status / tag / chip family: a single rounded-full
// shape at one size, the colour picked by `tone`. Static `<span>` by default;
// pass `onClick` and it becomes an interactive chip (a `<button>` with a hover)
// for filter / selection toggles. The tones mirror the button tones so the two
// languages line up:
//   accent   active / open / detected / selected
//   neutral  default / tag / closed / inactive
//   danger   a revoked / error state
//   strong   a completed end-state (white, not green: completion isn't a win)
// Replaces the STATUS_PILL_* / FILTER_CHIP_* / TAG_CHIP / BETA_PILL tone
// constants and the inline status chips.
export type PillTone = "accent" | "neutral" | "danger" | "strong";

const BASE =
  "inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";

// Each tone is a base surface paint (../ui/styles, the single source shared with
// the active-nav treatments) plus the pill's own border. `danger` / `strong`
// have no nav counterpart, so they carry their full paint here. Internal on
// purpose: the tones are only reachable through `<Pill tone>`, so a pill look
// can't be recomposed on bespoke markup.
const PILL_TONE: Record<PillTone, string> = {
  accent: `${ACCENT_SURFACE} border border-orange-500/30`,
  neutral: `${NEUTRAL_SURFACE} border border-neutral-700`,
  danger: "bg-red-500/10 text-red-300 border border-red-500/30",
  strong: "bg-neutral-100/10 text-neutral-100 border border-neutral-100/20",
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
  const cls = cn(
    BASE,
    PILL_TONE[tone],
    onClick && "transition-colors hover:brightness-110 cursor-pointer",
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
