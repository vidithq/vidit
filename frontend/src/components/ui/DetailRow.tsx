import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

// Label/value definition rows shared by the geolocation detail body (page and
// dense map-panel `compact` variant) and the request detail page. Pass a
// text-ish `value`, or a raw node (a `StatusBadge`, a `SourceLabel`) as
// `children`, rendered as-is.

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
  // Label left, value right, on one line at every width. At 320px the content
  // column (about 200px) is outgrown by a source host or close reason, so
  // `*:min-w-0` lifts the flex floor: a `truncate` value cuts to the room it has,
  // and a wrapping one takes the lines it needs beside the label. `gap-x-4` is
  // the only channel (a value child adds no margin). The label never shrinks.
  //
  // No `flex-wrap`: it would drop a truncating value to its own line before
  // `truncate` engaged.
  const rowClass = cn(
    "flex justify-between gap-x-4 *:min-w-0",
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
