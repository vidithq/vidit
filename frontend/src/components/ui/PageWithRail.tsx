import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A main column with a sticky right rail from `lg` up, inside `PageShell`.
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
  children,
}: {
  rail?: ReactNode;
  /** Accessible name of the rail's `aside` landmark. */
  railLabel?: string;
  narrow?: "stacked" | "hidden";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-6",
        rail && "lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start",
      )}
    >
      {rail && (
        <aside
          aria-label={railLabel}
          className={cn(
            "min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto",
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
