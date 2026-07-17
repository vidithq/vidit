import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

/**
 * One collapsible filter section, shared by the map's filter overlay and the
 * search page's filter area. Open/closed state is owned by the parent
 * (controlled via `open` + `onToggle`) so a panel re-render — e.g. toggling
 * "show all tags" — never resets which sections are expanded. While collapsed
 * the header shows a one-line state summary (orange when active); heavy
 * controls (the timelines) only mount when open.
 */
export function FilterSection({
  title,
  concept,
  summary,
  active,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** Shared `?` concept for this filter (same registry as the forms / detail
   *  page). Omit for filter-only controls with no domain concept. */
  concept?: Concept;
  summary: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  // The header is a row, not one button: the `?` is its own button (a button
  // can't nest inside another), so the title + the summary/chevron each toggle
  // the section while the `?` opens its tooltip independently.
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <div className="w-full flex items-center justify-between py-2.5 group">
        <span className="flex items-center gap-1 min-w-0">
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors"
          >
            {title}
          </button>
          {concept && <FieldHelp concept={concept} size={12} />}
        </span>
        <button
          onClick={onToggle}
          aria-label={`Toggle ${title}`}
          className="flex items-center gap-1.5 min-w-0"
        >
          {!open && (
            <span
              className={`text-[11px] truncate max-w-[150px] ${
                active ? "text-orange-400" : "text-neutral-600"
              }`}
            >
              {summary}
            </span>
          )}
          {open ? (
            <ChevronUp size={13} className="text-neutral-500 shrink-0" />
          ) : (
            <ChevronDown size={13} className="text-neutral-500 shrink-0" />
          )}
        </button>
      </div>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

/** Collapsed-header summary for a chip bucket: "Any", a single value, or
 *  "first +N". */
export function chipSummary(values: string[]): string {
  if (values.length === 0) return "Any";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

const fmtMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** Compact "start – end" summary from two optional ISO dates ("" = open). */
export function rangeSummary(from: string, to: string): string {
  if (!from && !to) return "Any";
  return `${from ? fmtMonth(from) : "…"} – ${to ? fmtMonth(to) : "…"}`;
}
