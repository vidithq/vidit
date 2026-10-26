import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { TAP_STEP } from "./Button";
import { HOVER_REVEAL } from "./styles";
import { PreferenceText } from "./ToggleRow";

/**
 * A row that is one action on a named thing, the sibling of `<ToggleRow>` and `<ChoiceRow>`: an
 * optional small picture, the label at reading size over a muted line, and the action's verb at
 * the right edge. The whole row is the button. The verb shows on hover and on keyboard focus,
 * and always on a touch screen, which has no hover.
 *
 * `done` is the static state the row shows once it has acted, in the verb's place; the row then
 * stops acting, and its accessible name becomes what it reads. Until then the name is
 * `aria-label`, which says the action and its target.
 */
export function ActionRow({
  leading,
  label,
  description,
  actionLabel,
  done,
  disabled = false,
  onAct,
  "aria-label": ariaLabel,
  className = "",
}: {
  /** A small picture before the text, such as a cover thumbnail. */
  leading?: ReactNode;
  label: string;
  description?: ReactNode;
  /** The verb shown at the right edge: *Add*. */
  actionLabel: string;
  /** The state once the row has acted: *Added 44*. */
  done?: ReactNode;
  /** Refuses the action while another write is in flight; dimmed. */
  disabled?: boolean;
  onAct: () => void;
  "aria-label"?: string;
  /** The caller's own divider and spacing. */
  className?: string;
}) {
  const acted = done !== undefined;
  return (
    <button
      type="button"
      onClick={onAct}
      disabled={disabled || acted}
      aria-label={acted ? undefined : ariaLabel}
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-2 text-left outline-none transition-colors",
        TAP_STEP,
        !acted && "hover:bg-orange-500/10 focus-visible:bg-orange-500/10",
        disabled && !acted && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {leading && <span className="shrink-0">{leading}</span>}
      <PreferenceText label={label} description={description} />
      <span className="shrink-0">
        {done ?? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium text-orange-400",
              HOVER_REVEAL,
              "group-focus-visible:opacity-100",
            )}
          >
            <Plus size={12} strokeWidth={2} aria-hidden />
            {actionLabel}
          </span>
        )}
      </span>
    </button>
  );
}
