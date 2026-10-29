import type { ComponentPropsWithRef } from "react";
import { ACTION_ICONS, Button } from "./Button";

/**
 * The remove control of a minor removal: a red cross named by what it removes, the name showing
 * as its tooltip, that removes at once. An important removal confirms in place through
 * `<ConfirmButton>` instead. `confirms` shows the trash on a control that opens a dialog to collect
 * what the removal needs (the edit form's Close and its reason).
 */
export function RemoveButton({
  label,
  confirms = false,
  iconSize = 14,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> & {
  /** The accessible name and the tooltip: *Remove source 2*, *Close this request*. */
  label: string;
  /** The click opens a dialog that asks before it removes. */
  confirms?: boolean;
  iconSize?: number;
}) {
  const Icon = ACTION_ICONS[confirms ? "delete" : "remove"];
  return (
    <Button icon variant="dangerGhost" aria-label={label} {...props}>
      <Icon size={iconSize} />
    </Button>
  );
}
