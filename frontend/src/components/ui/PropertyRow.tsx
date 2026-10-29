"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Concept } from "@/lib/fieldHelp";
import { TAP_STEP } from "./Button";
import { FieldHelp } from "./FieldHelp";
import { Pill } from "./Pill";
import { PopoverPanel } from "./Popover";

/** Above the map's floating panel (1000) and a sheet (1500), under a field's list (2000). */
const OVER_SHEET = "z-[1600]";

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
      {/* Positioned, so it stacks above a row-wide button. */}
      {concept && (
        <span className="relative inline-flex">
          <FieldHelp concept={concept} />
        </span>
      )}
    </span>
  );
}

type PropertyValue = { key: string; label: string; onRemove: () => void };

function ValuePills({ values }: { values: PropertyValue[] }) {
  return values.map((v) => (
    <span key={v.key} className="pointer-events-auto relative max-w-full">
      <Pill tone="accent" onClick={v.onRemove}>
        <span className="sr-only">Remove {v.label}</span>
        <span aria-hidden>{v.label}</span>
        <X size={11} aria-hidden />
      </Pill>
    </span>
  ));
}

/**
 * One property on one line: its name at the left and its values as removable accent pills at the
 * right, or a chevron while it holds none. A click anywhere on the line opens `editor` in a
 * popover anchored under it, so the line and everything under it stay where they are.
 */
export function PropertyRow({
  name,
  concept,
  values,
  editor,
}: {
  name: string;
  /** A `?` after the name. */
  concept?: Concept;
  values: PropertyValue[];
  /** The editor the popover holds, handed the close. */
  editor: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  // By id rather than a ref: the editor calls it, and a ref read there trips the compiler.
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(buttonId)?.focus();
  };
  return (
    <div
      ref={rowRef}
      className={cn(
        "group relative flex w-full items-start justify-between gap-3 py-2",
        TAP_STEP,
        open && "bg-neutral-800/60",
      )}
    >
      {/* An empty button over the whole line opens the editor, so the `?` and each pill stay
          buttons of their own, stacked above it, instead of nested in it. */}
      <button
        id={buttonId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name}
        onClick={() => setOpen((o) => !o)}
        className="absolute inset-0 rounded-xs"
      />
      <PropertyName name={name} concept={concept} className="group-hover:text-neutral-100" />
      <span className="pointer-events-none flex min-w-0 flex-wrap justify-end gap-1">
        <ValuePills values={values} />
        {values.length === 0 && (
          <ChevronDown size={14} aria-hidden className="mt-0.5 text-neutral-600" />
        )}
      </span>
      {open && (
        <PopoverPanel
          label={name}
          anchorRef={rowRef}
          align="end"
          onClose={close}
          className={OVER_SHEET}
        >
          {editor(() => close(true))}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * A property picked by search: its name at the left and `field`, a search field whose matches
 * open in a list under it, at the right of the same line. The values sit under the line as
 * removable accent pills.
 */
export function PropertySearchRow({
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
          <ValuePills values={values} />
        </div>
      )}
    </div>
  );
}
