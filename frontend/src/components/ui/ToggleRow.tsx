import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { Switch } from "./Switch";

/** An on/off row, shared by the filter surfaces and the settings page. The whole
 *  row is the switch (role + click live here), so `<Switch>` renders as its
 *  visual span and a tap anywhere toggles. It takes the phone tap step.
 *
 *  `description` picks the shape. Without one: the filter toggle (micro
 *  uppercase label on a divided list). With one: a preference row (label at
 *  reading size over a line saying what it does). Same control, semantics and
 *  tap target.
 *
 *  The accessible name is the label alone (`aria-labelledby`); the description
 *  reads after it as the row's own text. */
export function ToggleRow({
  label,
  description,
  on,
  onToggle,
  className = "",
}: {
  label: string;
  /** A line under the label; passing one moves the row to the settings shape. */
  description?: ReactNode;
  on: boolean;
  onToggle: () => void;
  /** The caller's own divider and spacing. */
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
