import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Concept } from "@/lib/fieldHelp";
import { PageColumns } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/** The sections of an event, named once for the page, the forms and the map panel. */
export const EVENT_SECTIONS = {
  sources: { title: "Sources", concept: "sources" },
  proof: { title: "Proof", concept: "section_proof" },
  location: { title: "Location", concept: "section_location" },
  details: { title: "Details", concept: "section_details" },
} as const satisfies Record<string, { title: string; concept: Concept }>;

type EventSection = keyof typeof EVENT_SECTIONS;

/** One section's filling: the card under the eyebrow, whether a publish flagged it (a red
 *  eyebrow), and a node beside the eyebrow (the proof's guide link). */
export interface EventSlot {
  content: ReactNode;
  invalid?: boolean;
  aside?: ReactNode;
}

/** The body of `EventShell`, filled the same way by the event page and the forms. */
export interface EventLayoutSlots {
  /** The sources row (`SourcesRow`), which heads itself. */
  sources: ReactNode;
  proof: EventSlot;
  details: EventSlot;
  location?: EventSlot | null;
  /** The event page's Sites block (`EventSitesBlock`), which heads itself, last in the side
   *  column. */
  sites?: ReactNode;
  form?: ComponentProps<"form">;
}

/** A section under its eyebrow. `besideScroller` levels the side column's first eyebrow with
 *  the sources row's 32px header. */
function Section({
  name,
  slot,
  besideScroller = false,
}: {
  name: Exclude<EventSection, "sources">;
  slot: EventSlot;
  besideScroller?: boolean;
}) {
  const { title, concept } = EVENT_SECTIONS[name];
  const eyebrow = (
    <SectionEyebrow
      title={title}
      concept={concept}
      invalid={slot.invalid}
      besideScroller={besideScroller && !slot.aside}
      margin={slot.aside ? "none" : "md"}
    />
  );
  return (
    <section>
      {slot.aside ? (
        // The aside is a sibling of the heading, so it stays out of the heading's name.
        <div className={cn("mb-3 flex items-center gap-1.5", besideScroller && "h-8")}>
          {eyebrow}
          {slot.aside}
        </div>
      ) : (
        eyebrow
      )}
      {slot.content}
    </section>
  );
}

/**
 * The body grid of `EventShell`: the one placement of an event's blocks and the one place their
 * eyebrows are spelled. Move a block here, not in a page. The column order is in
 * `docs/design.md` (Event layout).
 *
 * With `form`, the columns render inside a `<form>` laid out as `display: contents`. A control
 * outside it reaches the form through its `form` attribute.
 */
export function EventLayout({
  sources,
  proof,
  details,
  location,
  sites,
  form,
}: EventLayoutSlots) {
  const columns = (
    <PageColumns
      main={
        <>
          {sources}
          <Section name="proof" slot={proof} />
        </>
      }
      side={
        <>
          {location && <Section name="location" slot={location} besideScroller />}
          <Section name="details" slot={details} besideScroller={!location} />
          {sites}
        </>
      }
    />
  );
  return form ? (
    <form {...form} className={cn("contents", form.className)}>
      {columns}
    </form>
  ) : (
    columns
  );
}
