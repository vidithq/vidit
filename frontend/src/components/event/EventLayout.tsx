import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PAGE_COLUMNS_SPLIT } from "@/components/ui/PageShell";

/** The body of `EventShell`, filled the same way by the event page and the forms. */
export interface EventLayoutSlots {
  sources: ReactNode;
  proof: ReactNode;
  details: ReactNode;
  location?: ReactNode;
  form?: ComponentProps<"form">;
}

/**
 * The body grid of `EventShell`: the one placement of an event's blocks. Move a block here, not in
 * a page.
 *
 * From `lg` up, on the `PageColumns` split: the main column holds `sources` and `proof`; the side
 * column holds `location`, then `details`. Below `lg` one column reads the sources, proof,
 * location, then details.
 *
 * With `form`, the field blocks render inside a `<form>` laid out as `display: contents`, so the
 * grid still places them. A control outside it, in the title section or the actions block,
 * reaches the form through its `form` attribute.
 */
export function EventLayout({ sources, proof, details, location, form }: EventLayoutSlots) {
  const main = (
    <div className="min-w-0 space-y-6">
      {sources}
      {proof}
    </div>
  );
  const side = (
    <div className="min-w-0 space-y-6">
      {location}
      {details}
    </div>
  );
  return (
    <div className={cn("grid items-start gap-6", PAGE_COLUMNS_SPLIT)}>
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
    </div>
  );
}
