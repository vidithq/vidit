import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import { Pill } from "./Pill";
import type { Concept } from "@/lib/fieldHelp";

// Label/value definition rows shared by the event detail body (page and dense
// map-panel `compact` variant), the request detail page and the source blocks.
// Pass a text-ish `value`, or a raw node (a `StatusBadge`, a `SourceLabel`) as
// `children`, rendered as-is.

export function DetailCard({
  lead,
  label,
  children,
  className = "",
}: {
  /** A full-width slot above the rows, such as a source's file. */
  lead?: ReactNode;
  /** Makes the card a region with this accessible name. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const Root = label ? "section" : "div";
  return (
    <Root
      aria-label={label}
      className={cn(
        "bg-neutral-900 rounded-lg border border-neutral-700 divide-y divide-neutral-800",
        className,
      )}
    >
      {lead && <div className="px-4 py-3">{lead}</div>}
      {children}
    </Root>
  );
}

export function DetailRow({
  label,
  concept,
  value,
  empty,
  children,
  compact = false,
  align = "stretch",
  stacked = false,
  className = "",
}: {
  label: ReactNode;
  concept?: Concept;
  value?: ReactNode;
  /** Shown muted in place of an empty `value`, such as *Untitled*. */
  empty?: string;
  children?: ReactNode;
  compact?: boolean;
  align?: "stretch" | "center" | "start";
  /** The label on its own line and the value full width under it, for a list of values. */
  stacked?: boolean;
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
    stacked ? "flex flex-col gap-y-1.5" : "flex justify-between gap-x-4",
    "*:min-w-0",
    align === "center" && "items-center",
    align === "start" && "items-start",
    !compact && "px-4 py-3",
    className,
  );
  const text = compact ? "" : "text-sm";
  const blank = value === undefined || value === null || value === "";
  return (
    <div className={rowClass}>
      <span className={cn(text, "text-neutral-500 inline-flex shrink-0 items-center gap-1")}>
        {label}
        {concept && <FieldHelp concept={concept} />}
      </span>
      {children ?? (
        <span
          className={cn(
            text,
            "text-right [overflow-wrap:anywhere]",
            blank && empty ? "italic text-neutral-500" : "text-neutral-200",
          )}
        >
          {blank ? empty : value}
        </span>
      )}
    </div>
  );
}

/** A row value made of pills (conflicts, tags), wrapping flush right. */
export function DetailPills({
  items,
  compact = false,
}: {
  items: { id: string; name: string }[];
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap justify-end", compact ? "gap-1" : "gap-1.5")}>
      {items.map((item) => (
        <Pill key={item.id} tone="neutral">
          {item.name}
        </Pill>
      ))}
    </div>
  );
}
