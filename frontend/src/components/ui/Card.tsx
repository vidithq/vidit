import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

// Panel / section card: the `bg-neutral-900 rounded-lg border border-neutral-700
// p-5` shell, with one vertical rhythm (`space-y-4`) for every card. List-row
// shapes (the denser `border-neutral-800 rounded-md` tone) are a separate
// treatment.
export function Card({
  as: Tag = "div",
  className = "",
  children,
  "aria-label": label,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  /** Names a `section` card as a region. */
  "aria-label"?: string;
}) {
  return (
    <Tag
      aria-label={label}
      className={cn(
        "bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
