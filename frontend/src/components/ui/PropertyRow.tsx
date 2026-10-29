"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Concept } from "@/lib/fieldHelp";
import { FieldHelp } from "./FieldHelp";
import { Pill } from "./Pill";

/** A property's name with its `?`: a `<PropertyRow>`'s, or a control's that holds its own line
 *  under it (the filter panel's timelines). */
export function PropertyName({
  name,
  concept,
  className,
}: {
  name: string;
  concept?: Concept;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-sm text-neutral-400", className)}>
      {name}
      {concept && <FieldHelp concept={concept} />}
    </span>
  );
}

type PropertyValue = { key: string; label: string; onRemove: () => void };

/**
 * One property on one line: its name at the left and `field`, a search field whose matches open
 * in a list under it, at the right. The values sit under the line as removable accent pills.
 */
export function PropertyRow({
  name,
  concept,
  values,
  field,
}: {
  name: string;
  concept?: Concept;
  values: PropertyValue[];
  field: ReactNode;
}) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <PropertyName name={name} concept={concept} />
        <div className="w-[55%] max-w-56 shrink-0">{field}</div>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {values.map((v) => (
            <Pill key={v.key} tone="accent" title={`Remove ${v.label}`} onRemove={v.onRemove}>
              {v.label}
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
}
