import type { ReactNode, Ref } from "react";

import type { Concept } from "@/lib/fieldHelp";
import { EVENT_SECTIONS } from "@/components/event/EventLayout";
import { HorizontalScroller, type HorizontalScrollerHandle } from "@/components/ui/HorizontalScroller";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/** What a sources row calls its section and its items: an event's sources, or a site's images. */
export interface SourcesNames {
  title: string;
  concept: Concept;
  /** One item, lower case, for the arrows' names (*Previous source*). */
  item: string;
  /** The line an empty row shows. */
  empty: string;
}

export const EVENT_SOURCE_NAMES: SourcesNames = {
  ...EVENT_SECTIONS.sources,
  item: "source",
  empty: "No source yet",
};

/**
 * An event's sources as one sideways row under a **Sources (N)** eyebrow, on the event page and
 * on every event form: a `HorizontalScroller` whose header holds the eyebrow, the arrows from two
 * sources, and `actions`. A lone source takes the row's full width. The header is always as tall
 * as the scroller's 32px buttons, which `EventLayout` levels the side column with.
 *
 * `invalid` turns the eyebrow red and `note` says why, in the header row, so it moves no card
 * down. `names` retitles the row for a site's images.
 */
export function SourcesRow({
  count,
  names = EVENT_SOURCE_NAMES,
  invalid = false,
  note,
  actions,
  ref,
  children,
}: {
  count: number;
  names?: SourcesNames;
  invalid?: boolean;
  note?: ReactNode;
  actions?: ReactNode;
  ref?: Ref<HorizontalScrollerHandle>;
  children: ReactNode;
}) {
  const { title, concept, item } = names;
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
      previousLabel={`Previous ${item}`}
      nextLabel={`Next ${item}`}
      actions={actions}
    >
      {children}
    </HorizontalScroller>
  );
}
