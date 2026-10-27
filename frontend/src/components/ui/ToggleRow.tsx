import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { Switch } from "./Switch";

/** A described row's text: the label at reading size over a muted line. `<ToggleRow>`,
 *  `<ChoiceRow>` and `<ActionRow>` share it. */
export function PreferenceText({
  label,
  description,
  descriptionId,
}: {
  label: string;
  description?: ReactNode;
  descriptionId?: string;
}) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="block text-sm text-neutral-200">
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
 *  `variant` picks the shape, by default from `description`. `filter`: the filter
 *  toggle (micro uppercase label on a divided list). `setting`: a preference row
 *  (label at reading size, over a line saying what it does when there is one).
 *  Same control, semantics and tap target.
 *
 *  The accessible name is the label alone (`aria-label`, not the text the button
 *  holds, which would fold the description in); the description is its accessible
 *  description. */
export function ToggleRow({
  label,
  description,
  variant = description === undefined ? "filter" : "setting",
  on,
  onToggle,
  disabled = false,
  className = "",
}: {
  label: string;
  /** A line under the label; passing one moves the row to the settings shape. */
  description?: ReactNode;
  variant?: "filter" | "setting";
  on: boolean;
  onToggle: () => void;
  /** Reads its state but refuses the toggle, dimmed. Pair it with a `description` saying why. */
  disabled?: boolean;
  /** The caller's own divider and spacing. */
  className?: string;
}) {
  const descriptionId = useId();
  const described = description !== undefined;
  const setting = variant === "setting";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={described ? descriptionId : undefined}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "w-full flex items-center justify-between gap-4 text-left group disabled:opacity-50 disabled:cursor-not-allowed",
        TAP_STEP,
        !setting && "py-2.5 border-b border-neutral-800 last:border-b-0",
        className,
      )}
    >
      {setting ? (
        <PreferenceText
          label={label}
          description={description}
          descriptionId={described ? descriptionId : undefined}
        />
      ) : (
        <span
          className="block min-w-0 text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors"
        >
          {label}
        </span>
      )}
      <Switch as="span" size={setting ? "md" : "sm"} on={on} />
    </button>
  );
}
