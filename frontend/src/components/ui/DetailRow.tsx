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
  leadBeside = false,
  label,
  children,
  className = "",
}: {
  /** A full-width slot above the rows, such as a source's file. */
  lead?: ReactNode;
  /** Puts `lead` left of the rows (3:2) once the card is 42rem wide; narrower, it stays on top. */
  leadBeside?: boolean;
  /** Makes the card a region with this accessible name. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const Root = label ? "section" : "div";
  const frame = "bg-neutral-900 rounded-lg border border-neutral-700";
  if (lead && leadBeside) {
    // The card is the container, so the split follows the column it sits in, not the viewport.
    return (
      <Root aria-label={label} className={cn(frame, "@container", className)}>
        <div className="grid grid-cols-1 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="border-b border-neutral-800 px-4 py-3 @2xl:border-r @2xl:border-b-0">
            {lead}
          </div>
          <div className="divide-y divide-neutral-800">{children}</div>
        </div>
      </Root>
    );
  }
  return (
    <Root aria-label={label} className={cn(frame, "divide-y divide-neutral-800", className)}>
      {lead && <div className="px-4 py-3">{lead}</div>}
      {children}
    </Root>
  );
}

export function DetailRow({
  label,
  concept,
  value,
  children,
  compact = false,
  align = "stretch",
  wrapLabel = false,
  className = "",
}: {
  label: ReactNode;
  concept?: Concept;
  value?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  align?: "stretch" | "center" | "start";
  /** For a value that holds one line at its full width (`shrink-0 ml-auto`): the label wraps
   *  to its longest word first, then the value drops under it, right-aligned. */
  wrapLabel?: boolean;
  className?: string;
}) {
  // Label left, value right, on one line at every width. At 320px the content
  // column (about 200px) is outgrown by a source host or close reason, so
  // `*:min-w-0` lifts the flex floor: a `truncate` value cuts to the room it has,
  // and a wrapping one takes the lines it needs beside the label. `gap-x-4` is
  // the only channel (a value child adds no margin). The label never shrinks.
  //
  // No `flex-wrap`: it would drop a truncating value to its own line before
  // `truncate` engaged. `wrapLabel` is the exception, for a value that never
  // truncates: the label's basis is its longest word, so the value drops to a
  // line of its own only when even the wrapped label leaves it no room.
  const rowClass = cn(
    "flex justify-between gap-x-4",
    wrapLabel && "flex-wrap gap-y-1",
    "*:min-w-0",
    align === "center" && "items-center",
    align === "start" && "items-start",
    !compact && "px-4 py-3",
    className,
  );
  const text = compact ? "" : "text-sm";
  return (
    <div className={rowClass}>
      <span
        className={cn(
          text,
          "text-neutral-500 inline-flex items-center gap-1",
          wrapLabel ? "grow basis-[min-content]" : "shrink-0",
        )}
      >
        {label}
        {concept && <FieldHelp concept={concept} />}
      </span>
      {children ?? (
        <span className={cn(text, "text-right text-neutral-200 [overflow-wrap:anywhere]")}>
          {value}
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
