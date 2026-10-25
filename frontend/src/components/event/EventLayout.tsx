import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PAGE_COLUMNS_SPLIT } from "@/components/ui/PageShell";

/** The body slots of `EventShell`, filled the same way by the event page and the forms. */
export interface EventLayoutSlots {
  /** Heads the main column: the title field of a form. The event page keeps its title in the
   *  header. */
  titleField?: ReactNode;
  sources: ReactNode;
  proof: ReactNode;
  details: ReactNode;
  location?: ReactNode;
  /** Under the details, outside the form (the geolocators of a published row). */
  afterDetails?: ReactNode;
  form?: ComponentProps<"form">;
}

/**
 * The body grid of `EventShell`: the one placement of an event's blocks. Move a block here, not in
 * a page.
 *
 * From `lg` up, on the `PageColumns` split: the main column holds `titleField`, `sources` and
 * `proof`; the side column holds `location`, then `details`. Below `lg` one column reads the title
 * field, sources, proof, location, then details.
 *
 * With `form`, the field blocks render inside a `<form>` laid out as `display: contents`, so the
 * grid still places them. A control outside it, in the sticky actions, reaches the form through
 * its `form` attribute. `afterDetails` follows the details outside the `<form>`, since it holds a
 * form of its own: from `lg` up the main column spans two grid rows and it takes the second row
 * of the side column.
 */
export function EventLayout({
  titleField,
  sources,
  proof,
  details,
  location,
  afterDetails,
  form,
}: EventLayoutSlots) {
  const hasAfter = afterDetails !== undefined && afterDetails !== null && afterDetails !== false;
  const main = (
    <div className={cn("min-w-0 space-y-6 lg:col-start-1 lg:row-start-1", hasAfter && "lg:row-span-2")}>
      {titleField}
      {sources}
      {proof}
    </div>
  );
  const side = (
    <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
      {location}
      {details}
    </div>
  );
  return (
    <div
      className={cn("grid items-start gap-6", PAGE_COLUMNS_SPLIT, hasAfter && "lg:grid-rows-[auto_1fr]")}
    >
      {form ? (
        <form {...form} className={cn("contents", form.className)}>
          {main}
          {side}
        </form>
      ) : (
        <>
          {main}
          {side}
        </>
      )}
      {hasAfter && <div className="min-w-0 lg:col-start-2 lg:row-start-2">{afterDetails}</div>}
    </div>
  );
}
