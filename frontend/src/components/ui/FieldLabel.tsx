import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Concept } from "@/lib/fieldHelp";
import { FieldHelp } from "./FieldHelp";
import { FORM_INVALID_LABEL, LABEL_TEXT } from "./form-styles";

/**
 * The label row over a form control: the label, then its `?`, then `trailing` (a counter, a
 * locked hint). The `?` sits outside the `<label>`, so the field's accessible name is the label's
 * words alone. With `htmlFor` the words are a `<label>`; without, a `<span>` (a control that
 * names itself: a segmented control, a switch, a file slot). `invalid` turns the row red.
 */
export function FieldLabel({
  label,
  concept,
  htmlFor,
  invalid = false,
  trailing,
  className,
}: {
  label: ReactNode;
  concept?: Concept;
  htmlFor?: string;
  invalid?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const Words = htmlFor ? "label" : "span";
  return (
    <span className={cn("flex items-center gap-1", LABEL_TEXT, invalid && FORM_INVALID_LABEL, className)}>
      <Words htmlFor={htmlFor}>{label}</Words>
      {concept && <FieldHelp concept={concept} />}
      {trailing}
    </span>
  );
}
