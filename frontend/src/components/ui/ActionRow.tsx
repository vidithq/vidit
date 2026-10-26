import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PreferenceText } from "./ToggleRow";

/**
 * A row that offers one action on a named thing, the sibling of `<ToggleRow>` and `<ChoiceRow>`:
 * the label at reading size over a muted line, and the caller's `action` at the right edge. The
 * row itself does nothing on a click, so only the action acts; the action names its own target
 * (`aria-label`), since the row has no accessible name of its own. A long label wraps beside the
 * action, which never shrinks.
 */
export function ActionRow({
  label,
  description,
  action,
  className = "",
}: {
  label: string;
  description?: ReactNode;
  /** A control, or the static state that replaces it once it has acted. */
  action: ReactNode;
  /** The caller's own divider and spacing. */
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <PreferenceText label={label} description={description} />
      <div className="shrink-0">{action}</div>
    </div>
  );
}
