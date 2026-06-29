import FieldHelp from "./FieldHelp";
import { OptionalHint } from "./OptionalHint";
import type { Concept } from "@/lib/fieldHelp";

// Form-section heading: the `<header><h2>` + section `FieldHelp` (+ optional
// hint) that every submit/edit form section hand-rolled identically.
export function SectionHeading({
  title,
  concept,
  optional = false,
}: {
  title: string;
  concept: Concept;
  optional?: boolean;
}) {
  return (
    <header>
      <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
        {title}
        <FieldHelp concept={concept} />
        {optional && <OptionalHint />}
      </h2>
    </header>
  );
}
