"use client";

import Link from "next/link";

import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { Tooltip } from "./Tooltip";

export interface AvatarStackItem {
  key: string;
  name: string;
  avatarUrl?: string | null;
  /** An organization takes the rounded square, an analyst the circle. */
  variant: "analyst" | "organization";
  /** The picture's accessible name and tooltip. */
  label: string;
  /** The picture's own page, which the picture links to. */
  href: string;
}

const SIZE = "size-7 text-[11px]";
// The page canvas as a ring, so overlapping pictures read as separate discs.
const RING = "ring-2 ring-neutral-950 outline-hidden focus-visible:ring-orange-400";

const SPACING = { overlap: "gap-y-1 -space-x-1.5", gap: "gap-1.5" } as const;

/**
 * A row of pictures: the approval stamps in the event page's Approvals card, the organization
 * logos on a profile. `spacing="gap"` sets the pictures apart instead of overlapping them. Each
 * picture links to its page and shows its label in a `<Tooltip>` on hover or keyboard focus. At
 * most `max` show; the rest collapse into a `+N` bubble, a button when `onOverflow` is set.
 */
export function AvatarStack({
  items,
  label,
  max = 5,
  spacing = "overlap",
  onOverflow,
  overflowLabel = (hidden) => `${hidden} more`,
}: {
  items: AvatarStackItem[];
  /** The list's accessible name. */
  label: string;
  max?: number;
  spacing?: keyof typeof SPACING;
  onOverflow?: () => void;
  overflowLabel?: (hidden: number) => string;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  const bubble = cn(
    SIZE,
    "flex items-center justify-center rounded-full bg-neutral-800 text-neutral-300 font-medium",
    RING,
  );
  return (
    <ul aria-label={label} className={cn("flex flex-wrap items-center", SPACING[spacing])}>
      {shown.map((item) => (
        <li key={item.key} className="flex shrink-0">
          <Tooltip label={item.label}>
            <Link
              href={item.href}
              aria-label={item.label}
              className={cn(
                "relative flex hover:z-20 focus-visible:z-20",
                item.variant === "organization" ? "rounded-md" : "rounded-full",
                RING,
              )}
            >
              <Avatar
                as="span"
                src={item.avatarUrl}
                username={item.name}
                size={SIZE}
                shape={item.variant === "organization" ? "square" : "circle"}
                decorative
              />
            </Link>
          </Tooltip>
        </li>
      ))}
      {hidden > 0 && (
        <li className="relative flex shrink-0">
          {onOverflow ? (
            <button
              type="button"
              onClick={onOverflow}
              aria-label={overflowLabel(hidden)}
              className={cn(bubble, "hover:bg-neutral-700 transition-colors")}
            >
              +{hidden}
            </button>
          ) : (
            <span className={bubble}>+{hidden}</span>
          )}
        </li>
      )}
    </ul>
  );
}
