import type { ReactNode } from "react";
import Link from "next/link";

import { TAPPABLE_HOVER } from "./styles";

export const TILE = "rounded-lg border border-neutral-800 bg-neutral-900 p-4";
export const TILE_TITLE = "text-sm font-medium text-neutral-100";

export function IconTile({
  icon,
  title,
  note,
  href,
}: {
  icon: ReactNode;
  title: string;
  note?: ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <h3
        className={`inline-flex items-center gap-1.5 ${TILE_TITLE} ${
          href ? "transition-colors group-hover:text-orange-400" : ""
        }`}
      >
        {icon}
        {title}
      </h3>
      {note !== undefined && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">{note}</p>
      )}
    </>
  );

  if (!href) return <div className={TILE}>{inner}</div>;

  return (
    <Link href={href} className={`group block ${TILE} ${TAPPABLE_HOVER}`}>
      {inner}
    </Link>
  );
}
