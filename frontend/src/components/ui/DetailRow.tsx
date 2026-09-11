import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

// Label/value definition rows shared by the geolocation detail body (page +
// dense map-panel `compact` variant) and the request detail page.
//
// Pass a text-ish value via `value` (wrapped in the value span) or a raw node
// (a `StatusBadge`, a `SourceLabel`) via `children`, which is rendered as-is.

export function DetailCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-neutral-900 rounded-lg border border-neutral-700 divide-y divide-neutral-800",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DetailRow({
  label,
  concept,
  value,
  children,
  compact = false,
  align = "stretch",
  className = "",
}: {
  label: ReactNode;
  concept?: Concept;
  value?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  align?: "stretch" | "center" | "start";
  className?: string;
}) {
  // Label left, value right, and the row gives way rather than squeezing. At
  // 320px the content column is about 200px, which a source host or a close
  // reason outgrows on its own: `*:min-w-0` lifts the automatic flex floor off
  // both halves, so a value that carries `truncate` cuts itself to the room it
  // has instead of holding the row open, and `flex-wrap` drops a value that
  // still cannot fit onto a line of its own under the label. `gap-x-4` is the
  // channel between the two while they share a line; the label never shrinks,
  // so it stays one line at every width.
  const rowClass = cn(
    "flex flex-wrap justify-between gap-x-4 *:min-w-0",
    align === "center" && "items-center",
    align === "start" && "items-start",
    !compact && "px-4 py-3",
    className,
  );
  return (
    <div className={rowClass}>
      <span
        className={`${
          compact ? "text-neutral-500" : "text-sm text-neutral-500"
        } inline-flex shrink-0 items-center gap-1`}
      >
        {label}
        {concept && <FieldHelp concept={concept} />}
      </span>
      {children ?? (
        <span className={compact ? "text-neutral-200" : "text-sm text-neutral-200"}>
          {value}
        </span>
      )}
    </div>
  );
}
