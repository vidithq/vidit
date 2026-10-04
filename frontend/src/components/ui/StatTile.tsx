import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { TAPPABLE_HOVER } from "./styles";

// A labelled metric tile (icon, uppercase label, value) and the grid that lays a
// row of them out. `small` shrinks the value for long content (a date, a
// conflict name).
//
// `href` makes the whole tile one `next/link` into the view the figure was read
// off, with the shared tappable hover and an accent value. Without it the tile is
// an inert `<div>`.

const SHELL = "block bg-neutral-900 rounded-lg border border-neutral-700 p-3";

// Keyboard affordance for the linked tile: the ring `<FieldHelp>` draws. The
// card hover is pointer-only, and the default outline suits a rounded card badly.
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

// Wraps a row of <StatTile>: two columns, four from `sm` up.
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
  );
}
