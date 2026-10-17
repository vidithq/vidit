import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A main column with a sticky 17.5rem right rail from `lg` up. `PageShell` composes it from its
 * `rail` prop; mount it directly only outside `PageShell` (the palette).
 *
 * The rail sticks while the main column scrolls. Once it is taller than the viewport it scrolls on
 * its own, so its foot stays reachable. Below `lg` the rail either stacks above the main column
 * (`narrow="stacked"`) or leaves the page (`narrow="hidden"`), for a page that offers its own
 * narrow entry point. Without a `rail` the main column takes the full width.
 */
export function PageWithRail({
  rail,
  railLabel,
  narrow = "stacked",
  topOffset = 0,
  children,
}: {
  rail?: ReactNode;
  /** Accessible name of the rail's `aside` landmark. */
  railLabel?: string;
  narrow?: "stacked" | "hidden";
  /** Height in px of a sticky header above the rail, which the rail sticks under. */
  topOffset?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-6",
        rail && "lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start",
      )}
    >
      {rail && (
        <aside
          aria-label={railLabel}
          style={{ "--rail-top": `${topOffset}px` } as CSSProperties}
          className={cn(
            "min-w-0 lg:sticky lg:top-[calc(var(--rail-top)+1.5rem)] lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-var(--rail-top)-3rem)] lg:overflow-y-auto",
            narrow === "hidden" && "max-lg:hidden",
          )}
        >
          {rail}
        </aside>
      )}
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">{children}</div>
    </div>
  );
}
