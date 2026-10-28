"use client";

import type { ComponentPropsWithoutRef } from "react";

import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { cn } from "@/lib/cn";
import { ACTION_ICONS, Button, DANGER_CONFIRM, type ButtonAction } from "./Button";

/** What the armed control reads: *Remove bo* becomes *Confirm remove bo*. */
function confirmLabel(label: string): string {
  return `Confirm ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * The one control of an important destructive action: red, it confirms in place. The first click
 * arms it, filled red and named *Confirm …*; a second click within `ARM_MS` runs `onConfirm`.
 * Escape, a click or focus elsewhere, or the timeout disarms it. `icon` draws the square icon
 * button named and tooltipped by `label`, with the action's icon (a trash for `delete`); otherwise
 * `label` is the text, after the action's icon, and `name` the accessible name when the text
 * alone is ambiguous in a list (*Remove* on each member row).
 */
export function ConfirmButton({
  label,
  name,
  action = "delete",
  icon = false,
  iconSize = 14,
  onConfirm,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"button">, "children" | "aria-label" | "onClick"> & {
  label: string;
  name?: string;
  action?: ButtonAction;
  icon?: boolean;
  iconSize?: number;
  onConfirm: () => void | Promise<unknown>;
}) {
  const { armed, trigger, controlRef } = useConfirmAction(
    () => void onConfirm(),
    { timeoutMs: ARM_MS, dismissOnOutside: true },
  );
  const classes = cn(className, armed && DANGER_CONFIRM);
  if (icon) {
    const Icon = ACTION_ICONS[action];
    return (
      <Button
        {...props}
        ref={controlRef}
        icon
        variant="dangerGhost"
        aria-label={armed ? confirmLabel(label) : label}
        className={classes}
        onClick={trigger}
      >
        <Icon size={iconSize} />
      </Button>
    );
  }
  return (
    <Button
      {...props}
      ref={controlRef}
      action={action}
      variant="danger"
      aria-label={name && (armed ? confirmLabel(name) : name)}
      className={classes}
      onClick={trigger}
    >
      {armed ? confirmLabel(label) : label}
    </Button>
  );
}
