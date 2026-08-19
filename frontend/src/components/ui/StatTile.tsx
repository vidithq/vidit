import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { TAPPABLE_HOVER } from "./styles";

// A labelled metric tile (icon + uppercase label + value) and the responsive
// grid that lays a row of them out. Generic enough to carry any KPI grid
// (author geolocation stats, admin metrics, ...). `small` shrinks the value
// for long content like a date or a conflict name.
//
// `href` makes the whole tile one click target into the view the figure was
// read off: the tile becomes a `next/link`, takes the shared tappable hover,
// and its value takes the accent with it. Without `href` the tile is a `<div>`
// that reads as paint, which is what a figure with nothing behind it should
// look like.

const SHELL = "block bg-neutral-900 rounded-lg border border-neutral-700 p-3";

// The keyboard affordance for the linked tile, the ring `<FieldHelp>` draws on
// its own trigger. The card hover alone is a pointer-only signal, and a whole
// tile is too large a target to leave the browser's default outline on a
// rounded card.
const FOCUS_RING =
  "outline-hidden focus-visible:ring-1 focus-visible:ring-orange-400";

export function StatTile({
  icon: Icon,
  label,
  value,
  small = false,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  small?: boolean;
  /** In-app route the tile opens. Absent: the tile is inert. */
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
        <Icon size={11} />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <span
        className={`${small ? "text-sm" : "text-lg"} font-medium text-neutral-100 ${
          href ? "group-hover:text-orange-400 transition-colors" : ""
        }`}
      >
        {value}
      </span>
    </>
  );

  if (!href) {
    return <div className={SHELL}>{inner}</div>;
  }

  return (
    <Link href={href} className={`group ${SHELL} ${TAPPABLE_HOVER} ${FOCUS_RING}`}>
      {inner}
    </Link>
  );
}

// Wraps a row of <StatTile>. Two columns on narrow, four from `sm` up, so a
// short or long row reflows instead of squeezing.
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
  );
}
