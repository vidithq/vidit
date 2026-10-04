import type { ElementType } from "react";
import { cn } from "@/lib/cn";
import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

// Uppercase "eyebrow" heading for the detail surfaces, plus section `FieldHelp`.
// Distinct from the form `SectionHeading` (`text-sm font-medium`). `margin`
// covers the page (`mb-3`), the dense panel (none) and the proof block
// (`mb-1.5`); `as` picks h2 (page) or h3 (panel).
const MARGIN = { none: "", sm: "mb-1.5", md: "mb-3" } as const;

export function SectionEyebrow({
  title,
  concept,
  as: Tag = "h2",
  margin = "md",
}: {
  title: string;
  concept?: Concept;
  as?: ElementType;
  margin?: keyof typeof MARGIN;
}) {
  return (
    <Tag
      className={cn(
        "text-xs text-neutral-500 uppercase tracking-wider",
        MARGIN[margin],
        concept && "inline-flex items-center gap-1.5",
      )}
    >
      {title}
      {concept && <FieldHelp concept={concept} />}
    </Tag>
  );
}
