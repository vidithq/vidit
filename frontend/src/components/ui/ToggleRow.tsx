import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Concept } from "@/lib/fieldHelp";
import { TAP_STEP } from "./Button";
import { FieldHelp } from "./FieldHelp";
import { Switch } from "./Switch";

/** A described row's text: the label at reading size over a muted line. `<ToggleRow>` and
 *  `<ChoiceRow>` share it. */
export function PreferenceText({
  label,
  concept,
  description,
  descriptionId,
}: {
  label: string;
  /** A `?` after the label. */
  concept?: Concept;
  description?: ReactNode;
  descriptionId?: string;
}) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="flex items-center gap-1 text-sm text-neutral-200">
        {label}
        {/* Positioned, so it stacks above the row-wide switch of a `<ToggleRow>`. */}
        {concept && (
          <span className="relative inline-flex">
            <FieldHelp concept={concept} />
          </span>
        )}
      </span>
      {description !== undefined && (
        <span id={descriptionId} className="block text-xs text-neutral-500">
          {description}
        </span>
      )}
    </span>
  );
}

/** A property's name with its `?`: a filter line's, or a control's that holds its own line
 *  under it (the filter panel's timelines). */
export function PropertyName({
  name,
  concept,
  className,
}: {
  name: string;
  concept?: Concept;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-sm text-neutral-400", className)}>
      {name}
      {concept && <FieldHelp concept={concept} />}
    </span>
  );
}

/** An on/off row, shared by the filter surfaces and the settings page. A button
 *  over the whole row is the switch (role + click live there), so `<Switch>`
 *  renders as its visual span and a tap anywhere toggles. It takes the phone tap step.
 *
 *  `variant` picks the shape, by default from `description`. `filter`: a line of the filter
 *  panel (its name like a `<PropertyRow>`'s, a small switch). `setting`: a preference row
 *  (label at reading size, over a line saying what it does when there is one).
 *  Same control, semantics and tap target.
 *
 *  The accessible name is the label alone (`aria-label`, not the text the button
 *  holds, which would fold the description in); the description is its accessible
 *  description. */
export function ToggleRow({
  label,
  concept,
  description,
  variant = description === undefined ? "filter" : "setting",
  on,
  onToggle,
  disabled = false,
  className = "",
}: {
  label: string;
  /** A `?` after the label. */
  concept?: Concept;
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
    <div
      className={cn(
        "relative w-full flex items-center justify-between text-left group",
        "gap-4",
        TAP_STEP,
        !setting && "py-2",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* The switch is an empty button over the whole row rather than the row itself, so the
          label's `?` stays a button of its own, stacked above it, instead of one nested in it. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        aria-describedby={described ? descriptionId : undefined}
        onClick={onToggle}
        disabled={disabled}
        className="absolute inset-0 rounded-xs disabled:cursor-not-allowed"
      />
      {setting ? (
        <PreferenceText
          label={label}
          concept={concept}
          description={description}
          descriptionId={described ? descriptionId : undefined}
        />
      ) : (
        <PropertyName name={label} concept={concept} className="group-hover:text-neutral-100" />
      )}
      <Switch as="span" size={setting ? "md" : "sm"} on={on} />
    </div>
  );
}
