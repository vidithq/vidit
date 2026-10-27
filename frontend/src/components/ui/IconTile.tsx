import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { Pill } from "./Pill";
import { META_LINE, TAPPABLE_HOVER } from "./styles";

export const TILE = "rounded-lg border border-neutral-800 bg-neutral-900 p-4";
export const TILE_TITLE = "text-sm font-medium text-neutral-100";

const NOTE = "text-[13px] leading-relaxed text-neutral-400";

// With a `preview` the tile is a row below `sm` (a thumbnail beside the text) and a card from `sm`
// up (the preview over the text). The preview draws once, in a 280x140 box: the thumbnail scales it
// to 112x56, so one drawing serves both layouts.
const PREVIEW_STAGE =
  "h-14 w-28 shrink-0 overflow-hidden rounded-md border border-neutral-800 sm:h-36 sm:w-full sm:rounded-none sm:border-0 sm:border-b lg:h-44";
const PREVIEW_DRAWING = "h-[140px] w-[280px] origin-top-left scale-[0.4] sm:size-full sm:scale-100";

function Needs({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={cn(META_LINE, "mr-0.5")}>Needs</span>
      {items.map((item) => (
        <Pill key={item} tone="neutral">
          {item}
        </Pill>
      ))}
    </div>
  );
}

export function IconTile({
  icon,
  title,
  note,
  href,
  preview,
  needs,
}: {
  icon: ReactNode;
  title: string;
  note?: ReactNode;
  href?: string;
  /** A drawing of what the tile leads to. Decorative: hidden from assistive tech. */
  preview?: ReactNode;
  /** What the reader needs in hand, as a "Needs" row of neutral pills at the tile's foot. */
  needs?: string[];
}) {
  const heading = (
    <h3
      className={`inline-flex items-center gap-1.5 ${TILE_TITLE} ${
        href ? "transition-colors group-hover:text-orange-400" : ""
      }`}
    >
      {icon}
      {title}
    </h3>
  );
  const needsRow = needs && needs.length > 0 && <Needs items={needs} />;

  const inner =
    preview === undefined ? (
      <>
        {heading}
        {note !== undefined && <p className={cn(NOTE, "mt-1.5")}>{note}</p>}
        {needsRow && <div className="mt-3">{needsRow}</div>}
      </>
    ) : (
      <>
        <div aria-hidden className={PREVIEW_STAGE}>
          <div className={PREVIEW_DRAWING}>{preview}</div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 sm:flex sm:flex-col sm:gap-2 sm:space-y-0 sm:p-4">
          {heading}
          {note !== undefined && <p className={cn(NOTE, "leading-snug sm:leading-relaxed")}>{note}</p>}
          {needsRow && <div className="sm:mt-auto sm:pt-1">{needsRow}</div>}
        </div>
      </>
    );

  const box =
    preview === undefined
      ? cn("block", TILE)
      : cn(
          "flex items-center gap-4 overflow-hidden sm:flex-col sm:items-stretch sm:gap-0",
          TILE,
          "p-3 sm:p-0",
        );

  if (!href) return <div className={box}>{inner}</div>;

  return (
    <Link href={href} className={cn("group", box, TAPPABLE_HOVER)}>
      {inner}
    </Link>
  );
}
