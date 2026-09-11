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
  // Label left, value right, on one line at every width. At 320px the content
  // column is about 200px, which a source host or a close reason outgrows on
  // its own: `*:min-w-0` lifts the automatic flex floor off both halves, so a
  // value that carries `truncate` cuts itself to the room it has instead of
  // holding the row open, and one that wraps on its own (the close reason is
  // `whitespace-pre-wrap`, a tag list is a wrapping flex row) takes the lines
  // it needs beside the label. `gap-x-4` is the channel between the two, and
  // the only one: a value child adds no margin of its own, or the gutter
  // doubles. The label never shrinks, so it stays one line at every width.
  //
  // No `flex-wrap`: it would drop a truncating value onto a line of its own
  // before `truncate` ever engaged, which is a different row from the one the
  // desktop map panel is laid out as.
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
