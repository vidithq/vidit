import type { ReactNode } from "react";

import { Pill } from "@/components/ui/Pill";

/**
 * Post-action receipt shared by the destructive admin panels (analyst delete,
 * geolocation delete): a quiet summary box with the hard/soft mode badge.
 * Hard reads danger (red); soft is neutral, the same vocabulary as the invite
 * StatusChip, so no bespoke badge colours (the two panels had drifted to
 * amber vs orange for the same semantic).
 */
export function ActionReceipt({
  mode,
  header,
  children,
}: {
  mode: "soft" | "hard";
  /** Inline nodes before the mode badge (the @username / title). */
  header: ReactNode;
  /** Detail lines under the header. */
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
      <div className="inline-flex items-center gap-1.5">
        {header}
        <Pill
          tone={mode === "hard" ? "danger" : "neutral"}
          className="uppercase tracking-wider"
        >
          {mode}
        </Pill>
      </div>
      {children}
    </div>
  );
}
