import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { TAP_STEP } from "./Button";
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
  // the section while the `?` opens its tooltip independently. The row is the
  // tap target all the same, the way `<ToggleRow>` makes its whole row the
  // switch: the summary/chevron toggle grows into every pixel right of the
  // title, so on a phone the only part of the header that is not a toggle is
  // the `?` itself.
  //
  // The vertical padding and the phone tap step sit on the two buttons rather
  // than on the row that holds them. On the row they size the row and leave
  // each button at its own 16px line box, which is a 36px strip with two 16px
  // targets in it; on the buttons they are the buttons' own border boxes, so
  // each one measures 36px below `sm` and the row takes its height from them.
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <div className="w-full flex items-stretch justify-between group">
        <span className="flex items-center gap-1 min-w-0">
          <button
            onClick={onToggle}
            aria-expanded={open}
            className={`flex self-stretch items-center py-2.5 ${TAP_STEP} text-left text-[10px] text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors`}
          >
            {title}
          </button>
          {concept && <FieldHelp concept={concept} size={12} />}
        </span>
        <button
          onClick={onToggle}
          aria-label={`Toggle ${title}`}
          className={`flex grow items-center justify-end gap-1.5 py-2.5 ${TAP_STEP} min-w-0`}
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
