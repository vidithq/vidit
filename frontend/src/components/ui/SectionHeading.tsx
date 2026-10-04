import type { ReactNode } from "react";
import { FieldHelp } from "./FieldHelp";
import { FORM_INVALID_LABEL } from "./form-styles";
import type { Concept } from "@/lib/fieldHelp";

// Form-section heading: `<header><h2>` + section `FieldHelp`, with an optional
// `trailing` badge slot.
export function SectionHeading({
  title,
  concept,
  trailing,
  invalid = false,
}: {
  title: string;
  concept: Concept;
  trailing?: ReactNode;
  /** Red: a single-field section missing at submit. */
  invalid?: boolean;
}) {
  return (
    // `trailing` is a sibling of the <h2>, not a child: inside it, a badge or
    // link would join the heading's accessible name.
    <header className="flex items-center gap-1.5">
      <h2
        className={`text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5${
          invalid ? ` ${FORM_INVALID_LABEL}` : ""
        }`}
      >
        {title}
        <FieldHelp concept={concept} />
      </h2>
      {trailing}
    </header>
  );
}
