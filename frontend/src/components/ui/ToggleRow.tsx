import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { Switch } from "./Switch";

/** An on/off row, shared by the filter surfaces and the settings page. The
 *  whole row is the switch (role + click live here), so the `<Switch>` renders
 *  as its visual span and a tap anywhere on the row toggles rather than having
 *  to land on a 20x36px track. It takes the phone tap step for the same reason.
 *
 *  `description` picks the shape. Without one the row is the filter toggle: a
 *  micro uppercase label on a divided list. With one it is a preference row,
 *  the label at reading size over a line that says what the preference does,
 *  which is the settings page. The two shapes differ in type and chrome only;
 *  the control, the semantics and the tap target are the same row.
 *
 *  The accessible name is the label alone (`aria-labelledby` on it), never the
 *  block: a screen reader announces the switch by what it switches, and the
 *  description reads after it as the row's own text. */
export function ToggleRow({
  label,
  description,
  on,
  onToggle,
  className = "",
}: {
  label: string;
  /** A line under the label, at `text-xs`. Passing one moves the row to the
   *  settings shape. */
  description?: ReactNode;
  on: boolean;
  onToggle: () => void;
  /** Orthogonal extras: the caller's own divider and spacing (the settings
   *  card separates its rows with a `border-t`). */
  className?: string;
}) {
  const labelId = useId();
  const described = description !== undefined;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      onClick={onToggle}
      className={cn(
        "w-full flex items-center justify-between gap-4 text-left group",
        TAP_STEP,
        !described && "py-2.5 border-b border-neutral-800 last:border-b-0",
        className,
      )}
    >
      <span className="block min-w-0">
        <span
          id={labelId}
          className={cn(
            "block",
            described
              ? "text-sm text-neutral-200"
              : "text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors",
          )}
        >
          {label}
        </span>
        {described && (
          <span className="block text-xs text-neutral-500">{description}</span>
        )}
      </span>
      <Switch as="span" size={described ? "md" : "sm"} on={on} />
    </button>
  );
}
