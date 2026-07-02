import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// A labelled metric tile (icon + uppercase label + value) and the responsive
// grid that lays a row of them out. Extracted from the profile's four stat
// tiles; generic enough to carry any KPI grid (author geolocation stats, admin
// metrics, ...). `small` shrinks the value for long content like a date.
export function StatTile({
  icon: Icon,
  label,
  value,
  small = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
      <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
        <Icon size={11} />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <span
        className={`${small ? "text-sm" : "text-lg"} font-medium text-neutral-100`}
      >
        {value}
      </span>
    </div>
  );
}

// Wraps a row of <StatTile>. Two columns on narrow, four from `sm` up, so a
// short or long row reflows instead of squeezing.
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
  );
}
