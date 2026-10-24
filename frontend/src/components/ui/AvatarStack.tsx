"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { HOVER_REVEAL } from "./styles";
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
  /** A remove control on the picture's top-right corner, revealed on hover or keyboard focus
   *  (a site admin's delete of an approval stamp). */
  remove?: { label: string; onClick: () => void };
}

const SIZE = "size-7 text-[11px]";
// The page canvas as a ring, so overlapping pictures read as separate discs.
const RING = "ring-2 ring-neutral-950 outline-hidden focus-visible:ring-orange-400";

const SPACING = { overlap: "gap-y-1 -space-x-1.5", gap: "gap-1.5" } as const;

// A 20px disc on the picture's corner. A 36px disc would cover the 28px picture, so on a touch
// screen the disc keeps its size and its hit area becomes a 36px square up and right of it,
// starting 6px into the disc so the picture's centre stays its link. `REMOVE_ROOM` keeps that
// square clear of the next picture and of the line above.
const REMOVE = cn(
  "absolute -right-1.5 -top-1.5 z-30 size-5 sm:size-5 rounded-full bg-neutral-900 text-neutral-400 ring-1 ring-neutral-700 hover:bg-neutral-900 hover:text-red-400",
  "before:absolute before:content-[''] pointer-coarse:before:-top-4 pointer-coarse:before:bottom-0 pointer-coarse:before:left-1.5 pointer-coarse:before:-right-5.5",
  HOVER_REVEAL,
);
const REMOVE_ROOM = "pointer-coarse:mt-4 pointer-coarse:mr-6";

// A 14px accent disc on the picture's bottom-right corner, ringed in the page colour so it reads
// on any picture. `orange-*` is the reader's accent (`globals.css`).
const CHECK =
  "pointer-events-none absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-orange-500 text-neutral-950 ring-2 ring-neutral-950";

/**
 * A row of pictures: the approval stamps under the event page's actions, the organization
 * logos on a profile. `spacing="gap"` sets the pictures apart instead of overlapping them.
 * `checked` puts an accent check badge on each picture's corner. Each picture links to its page
 * and shows its label in a `<Tooltip>` on hover or keyboard focus, or on a first tap on a touch
 * screen, where the second tap follows the link. At most `max` show; the rest
 * collapse into a `+N` bubble, a button when `onOverflow` is set.
 */
export function AvatarStack({
  items,
  label,
  max = 5,
  spacing = "overlap",
  checked = false,
  onOverflow,
  overflowLabel = (hidden) => `${hidden} more`,
}: {
  items: AvatarStackItem[];
  /** The list's accessible name. */
  label: string;
  max?: number;
  spacing?: keyof typeof SPACING;
  /** An accent check badge on every picture (the approval stamps). */
  checked?: boolean;
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
        <li key={item.key} className={cn("group relative flex shrink-0", item.remove && REMOVE_ROOM)}>
          <Tooltip label={item.label} tapToShow>
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
              {checked && (
                <span aria-hidden="true" className={CHECK}>
                  <Check size={9} strokeWidth={4} />
                </span>
              )}
            </Link>
          </Tooltip>
          {item.remove && (
            <Button
              icon
              variant="dangerGhost"
              aria-label={item.remove.label}
              onClick={item.remove.onClick}
              className={REMOVE}
            >
              <X size={12} />
            </Button>
          )}
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
