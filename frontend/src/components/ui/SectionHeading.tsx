import type { ReactNode } from "react";
import FieldHelp from "./FieldHelp";
import { OptionalHint } from "./OptionalHint";
import type { Concept } from "@/lib/fieldHelp";

// Form-section heading: the `<header><h2>` + section `FieldHelp` (+ optional
// hint, + an optional `trailing` slot for a per-section badge like a locked
// hint) that every submit/edit form section hand-rolled identically.
export function SectionHeading({
  title,
  concept,
  optional = false,
  trailing,
}: {
  title: string;
  concept: Concept;
  optional?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <header>
      <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
        {title}
        <FieldHelp concept={concept} />
        {optional && <OptionalHint />}
        {trailing}
      </h2>
    </header>
  );
}
