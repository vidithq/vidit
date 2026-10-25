import type { ElementType } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import { FORM_INVALID_LABEL } from "./form-styles";
import type { Concept } from "@/lib/fieldHelp";

// Uppercase "eyebrow" heading for the detail surfaces and a form's Sources
// section, plus section `FieldHelp`. Distinct from the form `SectionHeading`
// (`text-sm font-medium`). `margin` covers the page (`mb-3`), the dense panel
// (none) and the proof block (`mb-1.5`); `as` picks h2 (page) or h3 (panel).
const MARGIN = { none: "", sm: "mb-1.5", md: "mb-3" } as const;

export function SectionEyebrow({
  title,
  concept,
  as: Tag = "h2",
  margin = "md",
  besideScroller = false,
  invalid = false,
}: {
  title: string;
  concept?: Concept;
  as?: ElementType;
  margin?: keyof typeof MARGIN;
  /** Heads a column beside a `<HorizontalScroller>`: the heading takes a row as tall as the
   *  scroller's header (its 32 px buttons), so both columns' first blocks start level. */
  besideScroller?: boolean;
  /** Red: a form section missing at submit. */
  invalid?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "text-xs text-neutral-500 uppercase tracking-wider",
        MARGIN[margin],
        concept && "inline-flex items-center gap-1.5",
        besideScroller && "flex h-8 items-center",
        invalid && FORM_INVALID_LABEL,
      )}
    >
      {title}
      {concept && <FieldHelp concept={concept} />}
    </Tag>
  );
}
