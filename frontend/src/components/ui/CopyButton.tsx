"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";
import { buttonClasses } from "./Button";
import { TooltipButton } from "./Tooltip";

// Both marks share one grid cell. The swap to the check is instant; the way back fades, unless
// the reader asks for reduced motion.
const LAYER = "col-start-1 row-start-1";
const FADE = "motion-safe:transition-opacity motion-safe:duration-300";

/**
 * The one copy confirmation: an icon button whose mark turns into a check while `copied` holds
 * (`useCopyToClipboard` times it, 1.5 s) and fades back after. Its tooltip reads `announce` for
 * that time and shows on its own, a tap included, so the reader sees what landed. The accessible
 * name never changes, since a name that changes on click is re-announced as a new control;
 * `announce` reaches screen readers through a sibling live region instead.
 */
export function CopyButton({
  label,
  announce,
  icon,
  copied,
  onClick,
  disabled,
  className,
  variant = "ghost",
}: {
  /** The control's accessible name and tooltip. */
  label: string;
  /** Shown in the tooltip and said to screen readers once the copy lands, such as *Link copied*. */
  announce: string;
  /** The resting mark. */
  icon: ReactNode;
  copied: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** `secondary` boxes the control, for an action that stands beside a field rather than in it. */
  variant?: "ghost" | "secondary";
}) {
  return (
    <>
      <TooltipButton
        type="button"
        className={buttonClasses(variant, { icon: true, className })}
        tip={copied ? announce : label}
        shown={copied}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="grid">
          <span aria-hidden className={cn(LAYER, copied ? "opacity-0" : `opacity-100 ${FADE}`)}>
            {icon}
          </span>
          <span aria-hidden className={cn(LAYER, copied ? "opacity-100" : `opacity-0 ${FADE}`)}>
            <Check size={14} />
          </span>
        </span>
      </TooltipButton>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? announce : ""}
      </span>
    </>
  );
}
