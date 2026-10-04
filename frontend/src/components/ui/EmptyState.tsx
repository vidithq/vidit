import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The one empty-state grammar, in three variants:
 *
 * - `boxed` (default): a muted bordered one-liner for empty list pages. `children`
 *   is the sentence, often with an inline `TEXT_LINK` CTA.
 * - `plain`: headline, hint and CTA inside an existing container, with no box.
 * - `invite`: `plain`'s stack in a dashed hero box with an optional icon, for a
 *   first-run surface.
 *
 * `lead` is the headline, `children` the hint, `cta` the action node(s).
 */
export function EmptyState({
  variant = "boxed",
  icon: Icon,
  lead,
  cta,
  children,
  className = "",
}: {
  variant?: "boxed" | "plain" | "invite";
  icon?: LucideIcon;
  /** Plain and invite only. */
  lead?: string;
  /** Plain and invite only. */
  cta?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  if (variant === "boxed") {
    return (
      <div
        className={cn(
          "text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-6 text-center",
          className,
        )}
      >
        {children}
      </div>
    );
  }
  const invite = variant === "invite";
  return (
    <div
      className={cn(
        "text-center space-y-3",
        invite
          ? "bg-neutral-900/50 border border-dashed border-neutral-800 rounded-lg p-12 max-w-md mx-auto"
          : "py-8",
        className,
      )}
    >
      {Icon && <Icon size={32} className="mx-auto text-neutral-600" />}
      <div className="space-y-1">
        {lead && <p className="text-sm text-neutral-300">{lead}</p>}
        {children && (
          <p
            className={cn(
              "text-xs text-neutral-500",
              invite && "max-w-[240px] mx-auto",
            )}
          >
            {children}
          </p>
        )}
      </div>
      {cta && <div className="flex flex-col items-center gap-2 pt-1">{cta}</div>}
    </div>
  );
}
