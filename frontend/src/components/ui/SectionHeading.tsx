import type { ReactNode } from "react";
import { FieldHelp } from "./FieldHelp";
import { FORM_INVALID_LABEL } from "./form-styles";
import type { Concept } from "@/lib/fieldHelp";

// Form-section heading: the `<header><h2>` + section `FieldHelp` (+ an optional
// `trailing` slot for a per-section badge like a locked hint) that every
// submit/edit form section hand-rolled identically.
export function SectionHeading({
  title,
  concept,
  trailing,
  invalid = false,
}: {
  title: string;
  concept: Concept;
  trailing?: ReactNode;
  /** Flag the heading red: the section is a single-field block
   *  (`SourceMediaField`, `ProofEditorPanel`) missing at submit. */
  invalid?: boolean;
}) {
  return (
    // `trailing` renders as the heading's sibling, not its child: a badge or a
    // guide link inside the <h2> would join its accessible name ("Proof
    // Methodology guide"). The flex row keeps them on one line.
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
