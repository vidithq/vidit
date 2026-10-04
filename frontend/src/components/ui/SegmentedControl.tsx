import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ACCENT_SURFACE } from "./styles";

/**
 * Exclusive-choice bar: options in one bordered track, the active one painted.
 *
 * A group of `aria-pressed` toggle buttons, not an ARIA radiogroup: a radiogroup
 * advertises arrow-key navigation and a single tab stop, which this bar doesn't
 * implement.
 *
 * `tone: "danger"` on an option paints its active state red, for a destructive
 * mode (hard delete).
 */
export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  tone?: "accent" | "danger";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fullWidth = false,
  "aria-label": ariaLabel,
}: {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stretch the track at every width. Below `sm` it always stretches. */
  fullWidth?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5",
        // Stretches on request, or under `sm`, where an intrinsic-width track
        // runs past a 375px column and wrapped labels read broken.
        fullWidth ? "flex w-full" : "max-sm:flex max-sm:w-full",
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            // No re-fire on the active option (a handler may have side effects,
            // e.g. disarming a two-click confirm).
            onClick={() => !active && onChange(opt.value)}
            className={cn(
              // `truncate` keeps one line; `min-w-0` lets an option shrink below
              // `sm` only, where the track is pinned to the column and an
              // unshrinkable option would scroll the page sideways.
              "px-3 py-1 text-sm rounded transition-colors truncate max-sm:px-2 max-sm:min-w-0 max-sm:text-xs",
              fullWidth ? "flex-1" : "max-sm:flex-1",
              active
                ? opt.tone === "danger"
                  ? "bg-red-500/10 text-red-300"
                  : ACCENT_SURFACE
                : "text-neutral-400 hover:text-neutral-200",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
