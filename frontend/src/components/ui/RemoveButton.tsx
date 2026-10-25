import type { ComponentPropsWithRef } from "react";
import { Trash2, X } from "lucide-react";

import { Button } from "./Button";

/**
 * The one remove control: a red icon button named by what it removes, the name showing as its
 * tooltip. Its icon says what a click does: a trash when the removal asks for a confirmation
 * first (a second click, a dialog), a cross when it is instant.
 */
export function RemoveButton({
  label,
  confirms = false,
  iconSize = 14,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> & {
  /** The accessible name and the tooltip: *Remove source 2*, *Close this request*. */
  label: string;
  /** The click asks before it removes. */
  confirms?: boolean;
  iconSize?: number;
}) {
  const Icon = confirms ? Trash2 : X;
  return (
    <Button icon variant="dangerGhost" aria-label={label} {...props}>
      <Icon size={iconSize} />
    </Button>
  );
}
