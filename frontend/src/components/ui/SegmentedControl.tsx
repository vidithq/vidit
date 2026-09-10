import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ACCENT_SURFACE } from "./styles";

/**
 * Exclusive-choice bar: two or more options in one bordered track, the active
 * one painted. The submit page (single vs bulk import) and the admin delete
 * panel (soft vs hard) each hand-rolled this shape; the track + option paints
 * live here once.
 *
 * A group of `aria-pressed` toggle buttons, not an ARIA radiogroup: a
 * radiogroup advertises arrow-key navigation and a single tab stop, which this
 * one-tab-per-option bar doesn't implement, so pressed-toggle semantics
 * describe it honestly and stay operable with plain Tab.
 *
 * `tone: "danger"` on an option paints its active state red instead of the
 * accent, for a destructive mode (hard delete).
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
  /** Stretch the track at every width; options share it evenly. Below `sm` the
   *  track always stretches, `fullWidth` or not. */
  fullWidth?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5",
        // One stretch rule, two triggers: the caller asks for it, or the
        // viewport is under `sm`, where an intrinsic-width track with three
        // labelled options runs past a 375px column and the browser's answer
        // (wrapping each label) reads broken.
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
            // Re-clicking the active option is a no-op: don't re-fire onChange
            // (a caller's handler may have side effects, e.g. disarming a
            // two-click confirm).
            onClick={() => !active && onChange(opt.value)}
            className={cn(
              // `truncate` carries the one-line rule at every width (it is
              // `whitespace-nowrap` plus a clip), and `min-w-0` releases it to
              // shrink below `sm` only. From `sm` up an option keeps its
              // min-content width, so nothing ever clips there and the track
              // reads exactly as it did. Below `sm` the track is pinned to the
              // column: an option that can neither wrap nor shrink pushes the
              // track past the viewport and scrolls the page sideways, so the
              // long label shortens instead.
              "px-3 py-1 text-sm rounded transition-colors truncate max-sm:px-2 max-sm:min-w-0 max-sm:text-xs",
              // Shares the track under the same two triggers as the track's
              // own stretch above.
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
