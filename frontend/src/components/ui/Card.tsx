import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The card paint: the surface, the radius and the border every card shares (`Card`,
 *  `DetailCard`, the stat tiles, the map panel). */
export const CARD_FRAME = "bg-neutral-900 rounded-lg border border-neutral-700";

// Panel / section card: `CARD_FRAME` at `p-5`, with one vertical rhythm (`space-y-4`) for every
// card. `dense` is the reading density (`p-4`) the event page's cards take, and so every card of
// an event form. List-row shapes (the denser `border-neutral-800 rounded-md` tone) are a separate
// treatment.
export function Card({
  as: Tag = "div",
  dense = false,
  className = "",
  children,
  "aria-label": label,
}: {
  as?: ElementType;
  dense?: boolean;
  className?: string;
  children: ReactNode;
  /** Names a `section` card as a region. */
  "aria-label"?: string;
}) {
  return (
    <Tag
      aria-label={label}
      className={cn(CARD_FRAME, dense ? "p-4" : "p-5", "space-y-4", className)}
    >
      {children}
    </Tag>
  );
}
