import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ACCENT_SURFACE } from "./styles";

/**
 * Exclusive-choice bar: two or more options in one bordered track, the active
 * one painted. The submit page (geolocation vs bounty) and the admin delete
 * panel (soft vs hard) each hand-rolled this shape; the track + option paints
 * live here once.
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
  /** Stretch the track; options share the width evenly. */
  fullWidth?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5",
        fullWidth && "flex w-full",
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1 text-sm rounded transition-colors",
              fullWidth && "flex-1",
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
