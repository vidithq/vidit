import type { ReactNode, Ref } from "react";

import { EVENT_SECTIONS } from "@/components/event/EventLayout";
import { HorizontalScroller, type HorizontalScrollerHandle } from "@/components/ui/HorizontalScroller";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/**
 * An event's sources as one sideways row under a **Sources (N)** eyebrow, on the event page and
 * on every event form: a `HorizontalScroller` whose header holds the eyebrow, the arrows from two
 * sources, and `actions`. A lone source takes the row's full width. The header is always as tall
 * as the scroller's 32px buttons, which `EventLayout` levels the side column with.
 *
 * `invalid` turns the eyebrow red and `note` says why, in the header row, so it moves no card
 * down.
 */
export function SourcesRow({
  count,
  invalid = false,
  note,
  actions,
  ref,
  children,
}: {
  count: number;
  invalid?: boolean;
  note?: ReactNode;
  actions?: ReactNode;
  ref?: Ref<HorizontalScrollerHandle>;
  children: ReactNode;
}) {
  const { title, concept } = EVENT_SECTIONS.sources;
  return (
    <HorizontalScroller
      ref={ref}
      heading={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SectionEyebrow
            margin="none"
            title={`${title} (${count})`}
            concept={concept}
            invalid={invalid}
          />
          {note}
        </div>
      }
      label={title}
      previousLabel="Previous source"
      nextLabel="Next source"
      actions={actions}
    >
      {children}
    </HorizontalScroller>
  );
}
