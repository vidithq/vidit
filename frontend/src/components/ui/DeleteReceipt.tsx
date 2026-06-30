import type { ReactNode } from "react";

// The admin "what just got deleted" receipt: a neutral box + a header (optional
// icon + label + a mode chip) + caller-supplied detail lines. The trust panel
// and the geolocation-delete panel rendered the same box, header layout, and
// uppercase mode chip by hand; the shell + chip shape live here once. The chip
// tone and the cascade/sweep detail lines stay at the call site, since they
// differ per entity (a user vs a geolocation, amber vs orange soft-delete).
export function DeleteReceipt({
  icon,
  label,
  mode,
  modeTone,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  mode: string;
  /** Border + text colour classes for the mode chip. */
  modeTone: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2 rounded-md text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 space-y-1">
      <div className="inline-flex items-center gap-1.5">
        {icon}
        <span className="font-medium">{label}</span>
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${modeTone}`}
        >
          {mode}
        </span>
      </div>
      {children}
    </div>
  );
}
