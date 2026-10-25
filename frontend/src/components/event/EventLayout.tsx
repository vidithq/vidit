import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PAGE_COLUMNS_SPLIT } from "@/components/ui/PageShell";

/**
 * The one placement of an event's blocks, shared by the event page, the edit form and the submit
 * form, so a block sits in the same spot on every surface. Move a block here, not in a page.
 *
 * From `lg` up, on the `PageColumns` split: the main column holds `header`, `sources` and `proof`;
 * the side column holds `actions`, then `details`, then `location`. Below `lg` one column reads
 * header, sources, proof, details, location, then actions, which is also the DOM and tab order:
 * the actions act on the fields above them, as a rail with `narrowRail="below"` does.
 *
 * With `form`, the field blocks render inside a `<form>` laid out as `display: contents`, so the
 * grid still places them and the actions stay outside it (they may hold forms of their own). A
 * control in the actions reaches the form through its `form` attribute.
 */
export function EventLayout({
  header,
  sources,
  proof,
  details,
  location,
  actions,
  actionsLabel,
  form,
}: {
  /** Heads the main column: the title field of a form. The event page keeps its title in
   *  `PageShell`. */
  header?: ReactNode;
  sources: ReactNode;
  proof: ReactNode;
  details: ReactNode;
  location?: ReactNode;
  /** The form's writes. Top of the side column from `lg` up, last below it. */
  actions?: ReactNode;
  /** Accessible name of the actions' `aside` landmark. */
  actionsLabel?: string;
  form?: ComponentProps<"form">;
}) {
  const hasActions = actions !== undefined && actions !== null;
  // With actions, the main column spans both rows and the side fields take the second, so the
  // actions' height never pushes the sources down.
  const main = (
    <div className={cn("min-w-0 space-y-6 lg:col-start-1 lg:row-start-1", hasActions && "lg:row-span-2")}>
      {header}
      {sources}
      {proof}
    </div>
  );
  const side = (
    <div className={cn("min-w-0 space-y-6 lg:col-start-2", hasActions ? "lg:row-start-2" : "lg:row-start-1")}>
      {details}
      {location}
    </div>
  );
  return (
    <div
      className={cn(
        "grid items-start gap-6",
        PAGE_COLUMNS_SPLIT,
        hasActions && "lg:grid-rows-[auto_1fr]",
      )}
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
      {hasActions && (
        <aside aria-label={actionsLabel} className="min-w-0 lg:col-start-2 lg:row-start-1">
          {actions}
        </aside>
      )}
    </div>
  );
}
