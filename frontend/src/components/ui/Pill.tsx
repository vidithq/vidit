import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { ACCENT_SURFACE } from "./styles";

// The one pill for the status / tag / chip family: one rounded-full shape, the
// colour picked by `tone`. A static `<span>` by default; with `onClick` it is an
// interactive chip (a `<button>`) for filter / selection toggles. The tones
// mirror the button tones:
//   accent     active / open / detected / selected (filled accent)
//   secondary  accent outline, no fill: a softer marked state
//   neutral    default / tag / closed / inactive
//   danger     a revoked / error state
export type PillTone = "accent" | "secondary" | "neutral" | "danger";

// `max-w-full wrap-anywhere`: a pill never outgrows its box. `shrink-0` alone
// would let a long single word (a tag name in a 150px card column at 320px) run
// past the card. It must be `anywhere`, not `break-words`: an `inline-flex`
// box's min-content width ignores `break-word` opportunities, so the box would
// stay as wide as the word. The same token breaks the account email in
// `app/settings/page.tsx` and the page subtitle in `PageShell`.
const BASE =
  "inline-flex items-center gap-1 shrink-0 max-w-full wrap-anywhere rounded-full px-2 py-0.5 text-[11px] font-medium";

// The accent tone is `ACCENT_SURFACE` plus a border; the other tones carry their
// full paint. Internal so a pill look can't be recomposed on bespoke markup.
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
  /** Orthogonal extras; conflicts resolve caller-wins via `cn`. */
  className?: string;
  children: ReactNode;
  /** Makes the pill an interactive chip. The caller drives the tone. */
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
  // An interactive chip takes `<Button>`'s phone tap step (a resting pill is
  // about 19px). A static pill keeps the resting height.
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
