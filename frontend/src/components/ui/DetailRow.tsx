import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

// Label/value definition rows shared by the geolocation detail body (page +
// dense map-panel `compact` variant) and the bounty detail page, which had
// hand-rolled the same `row`/`label`/`value` class strings separately.
//
// Pass a text-ish value via `value` (wrapped in the value span) or a raw node
// (a `StatusBadge`, a `SourceLabel`) via `children`, which is rendered as-is so
// the markup matches what those rows produced before.

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
  const rowClass = cn(
    "flex justify-between",
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
        } inline-flex items-center gap-1`}
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
