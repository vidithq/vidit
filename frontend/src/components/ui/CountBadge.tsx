"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Pill } from "./Pill";
import { Tooltip } from "./Tooltip";

// The badge straddles the control's top-right corner, 8px out, and the wrapper's `mr-2` keeps
// that overhang off the next control. On a touch screen the hit area grows to about 36px,
// spreading up and into the control's corner rather than sideways onto its neighbour.
const BADGE = cn(
  "absolute -right-2 -top-2 z-10 flex rounded-full bg-neutral-950 outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400",
  "before:absolute before:content-[''] pointer-coarse:before:-left-3.5 pointer-coarse:before:-right-1 pointer-coarse:before:-top-2.5 pointer-coarse:before:-bottom-2.5",
);

/**
 * A control with a red count on its top-right corner, of what it still lacks (the missing
 * conditions of a publish button). `label` names them; it shows in a `<Tooltip tapToShow>` on
 * hover or keyboard focus of the badge, or on a tap on a touch screen, so a tap on the control
 * itself still acts. The bubble hangs under the control, not over it. The badge is a sibling of the control, never inside it: `children` receives
 * the id of a hidden copy of `label` for the control's `aria-describedby`. A description read
 * off the badge itself would be its text, the bare count. No badge while `count` is 0.
 */
export function CountBadge({
  count,
  label,
  children,
}: {
  count: number;
  /** The badge's accessible name and tooltip: `2 missing: Title, Conflict`. */
  label: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  return (
    <span className="relative mr-2 inline-flex">
      {children(count > 0 ? id : undefined)}
      {count > 0 && (
        <>
          <Tooltip label={label} tapToShow underParent>
            <button type="button" aria-label={label} className={BADGE}>
              <Pill tone="danger" className="min-w-4 justify-center px-1 py-0 text-[10px] tabular-nums">
                {count}
              </Pill>
            </button>
          </Tooltip>
          <span id={id} hidden>
            {label}
          </span>
        </>
      )}
    </span>
  );
}
