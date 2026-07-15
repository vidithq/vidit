import type { ReactNode } from "react";
import { FieldHelp } from "./FieldHelp";
import { OptionalHint } from "./OptionalHint";
import { FORM_INVALID_LABEL } from "./form-styles";
import type { Concept } from "@/lib/fieldHelp";

// Form-section heading: the `<header><h2>` + section `FieldHelp` (+ optional
// hint, + an optional `trailing` slot for a per-section badge like a locked
// hint) that every submit/edit form section hand-rolled identically.
export function SectionHeading({
  title,
  concept,
  optional = false,
  trailing,
  invalid = false,
}: {
  title: string;
  concept: Concept;
  optional?: boolean;
  trailing?: ReactNode;
  /** Flag the heading red: the section is a single-field block
   *  (`SourceMediaField`, `ProofEditorPanel`) missing at submit. */
  invalid?: boolean;
}) {
  return (
    <header>
      <h2
        className={`text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5${
          invalid ? ` ${FORM_INVALID_LABEL}` : ""
        }`}
      >
        {title}
        <FieldHelp concept={concept} />
        {optional && <OptionalHint />}
        {trailing}
      </h2>
    </header>
  );
}
