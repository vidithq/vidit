"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { ConfirmButton } from "./ConfirmButton";
import { RemoveButton } from "./RemoveButton";
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
  /** The picture's own page, which the picture links to. Without one the picture is not a link
   *  (a co-geolocator picked on a form, whose username may be typed text). */
  href?: string;
  /** A remove control on the picture's top-right corner, revealed on hover or keyboard focus
   *  (a site admin's delete of an approval stamp, a co-geolocator taken off a byline). `confirms`
   *  for an important removal: a trash that confirms in place, else a cross that removes at once. */
  remove?: { label: string; onClick: () => void; confirms?: boolean };
  /** Faded, for an account not credited yet (a pending co-geolocator invitation). */
  muted?: boolean;
}

// `md` is the 28px stamp; `sm` is the 20px picture of a page byline, read or managed, and `xs`
// the 16px one of a card's byline (`<AuthorByline>` sets both), so a byline line keeps one
// height whether it lists or manages the geolocators.
const SIZES = {
  md: { picture: "size-7 text-[11px]", remove: "size-5 sm:size-5", mark: 12 },
  sm: { picture: "size-5 text-[10px]", remove: "size-4 sm:size-4", mark: 10 },
  xs: { picture: "size-4 text-[9px]", remove: "size-4 sm:size-4", mark: 10 },
} as const;
const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-orange-400";
// Overlapping pictures take the page canvas as a ring, so they read as separate discs.
const OVERLAP_RING = "ring-2 ring-neutral-950";

const SPACING = { overlap: "gap-y-1 -space-x-1.5", gap: "gap-1.5" } as const;

// A 20px disc on the picture's corner. A 36px disc would cover the 28px picture, so on a touch
// screen the disc keeps its size and its hit area becomes a 36px square up and right of it,
// starting 6px into the disc so the picture's centre stays its link. `REMOVE_ROOM` keeps that
// square clear of the next picture and of the line above.
const REMOVE = cn(
  "absolute -right-1.5 -top-1.5 z-30 rounded-full bg-neutral-900 ring-1 ring-neutral-700 hover:bg-neutral-900",
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
 * screen, where the second tap follows the link. Every item shows.
 */
export function AvatarStack({
  items,
  label,
  spacing = "overlap",
  checked = false,
  size = "md",
  trailing,
  className,
}: {
  items: AvatarStackItem[];
  /** The list's accessible name. */
  label: string;
  spacing?: keyof typeof SPACING;
  /** An accent check badge on every picture (the approval stamps). */
  checked?: boolean;
  size?: keyof typeof SIZES;
  /** After the last picture, on its line (the approvals' `?`). Use it with `spacing="gap"`. */
  trailing?: ReactNode;
  className?: string;
}) {
  if (items.length === 0) return null;
  const dims = SIZES[size];
  const ring = cn(FOCUS_RING, spacing === "overlap" && OVERLAP_RING);
  const row = cn("flex flex-wrap items-center", SPACING[spacing], className);
  const list = (
    <ul aria-label={label} className={trailing ? "contents" : row}>
      {items.map((item) => {
        const boxClass = cn(
          "relative flex hover:z-20 focus-visible:z-20",
          item.variant === "organization" ? "rounded-md" : "rounded-full",
          ring,
          item.muted && "opacity-50",
        );
        const picture = (
          <>
            <Avatar
              as="span"
              src={item.avatarUrl}
              username={item.name}
              size={dims.picture}
              shape={item.variant === "organization" ? "square" : "circle"}
              decorative
            />
            {checked && (
              <span aria-hidden="true" className={CHECK}>
                <Check size={9} strokeWidth={4} />
              </span>
            )}
          </>
        );
        return (
          <li key={item.key} className={cn("group relative flex shrink-0", item.remove && REMOVE_ROOM)}>
            <Tooltip label={item.label} tapToShow>
              {item.href ? (
                <Link href={item.href} aria-label={item.label} className={boxClass}>
                  {picture}
                </Link>
              ) : (
                <span role="img" aria-label={item.label} tabIndex={0} className={boxClass}>
                  {picture}
                </span>
              )}
            </Tooltip>
            {item.remove &&
              (item.remove.confirms ? (
                <ConfirmButton
                  icon
                  label={item.remove.label}
                  onConfirm={item.remove.onClick}
                  iconSize={dims.mark}
                  className={cn(REMOVE, dims.remove)}
                />
              ) : (
                <RemoveButton
                  label={item.remove.label}
                  onClick={item.remove.onClick}
                  iconSize={dims.mark}
                  className={cn(REMOVE, dims.remove)}
                />
              ))}
          </li>
        );
      })}
    </ul>
  );
  if (!trailing) return list;
  // The list's pictures flow in the row beside `trailing`, so it wraps with the last line rather
  // than under the whole list, and stays out of the list's items.
  return (
    <div className={row}>
      {list}
      <span className="flex shrink-0 items-center">{trailing}</span>
    </div>
  );
}
