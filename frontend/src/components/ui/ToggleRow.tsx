import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { Switch } from "./Switch";

/** A settings preference's text: the label at reading size over a line saying what it does. */
function PreferenceText({
  label,
  labelId,
  description,
  descriptionId,
}: {
  label: string;
  labelId?: string;
  description?: ReactNode;
  descriptionId?: string;
}) {
  return (
    <span className="block min-w-0 flex-1">
      <span id={labelId} className="block text-sm text-neutral-200">
        {label}
      </span>
      {description !== undefined && (
        <span id={descriptionId} className="block text-xs text-neutral-500">
          {description}
        </span>
      )}
    </span>
  );
}

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
 *  is its accessible description. */
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
  const descriptionId = useId();
  const described = description !== undefined;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      aria-describedby={described ? descriptionId : undefined}
      onClick={onToggle}
      className={cn(
        "w-full flex items-center justify-between gap-4 text-left group",
        TAP_STEP,
        !described && "py-2.5 border-b border-neutral-800 last:border-b-0",
        className,
      )}
    >
      {described ? (
        <PreferenceText
          label={label}
          labelId={labelId}
          description={description}
          descriptionId={descriptionId}
        />
      ) : (
        <span
          id={labelId}
          className="block min-w-0 text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors"
        >
          {label}
        </span>
      )}
      <Switch as="span" size={described ? "md" : "sm"} on={on} />
    </button>
  );
}
