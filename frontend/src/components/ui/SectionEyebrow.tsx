import type { ElementType } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { FieldHelp } from "./FieldHelp";
import { FORM_INVALID_LABEL } from "./form-styles";
import type { Concept } from "@/lib/fieldHelp";

// Uppercase "eyebrow" heading for the detail surfaces and an event form's
// sections, plus section `FieldHelp`. Distinct from the in-card form
// `SectionHeading` (`text-sm font-medium`). `margin` covers the page (`mb-3`), the dense panel
// (none) and the proof block (`mb-1.5`); `as` picks h2 (page) or h3 (panel). `toggle` makes the
// title a button that shows or hides the section, with a chevron that turns when it opens.
const MARGIN = { none: "", sm: "mb-1.5", md: "mb-3" } as const;

export function SectionEyebrow({
  title,
  concept,
  as: Tag = "h2",
  margin = "md",
  besideScroller = false,
  invalid = false,
  toggle,
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
  /** `controls` is the id of the section's body while it is shown. */
  toggle?: { open: boolean; onToggle: () => void; controls?: string };
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
      {toggle ? (
        <button
          type="button"
          aria-expanded={toggle.open}
          aria-controls={toggle.controls}
          onClick={toggle.onToggle}
          className={cn(
            "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-neutral-300",
            TAP_STEP,
          )}
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={cn("transition-transform", toggle.open && "rotate-90")}
          />
          {title}
        </button>
      ) : (
        title
      )}
      {concept && <FieldHelp concept={concept} />}
    </Tag>
  );
}
