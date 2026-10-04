import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { TAP_STEP } from "./Button";
import { FieldHelp } from "./FieldHelp";
import type { Concept } from "@/lib/fieldHelp";

/**
 * One collapsible filter section, shared by the map's filter overlay and the
 * search page. The parent controls `open` + `onToggle`, so a re-render never
 * resets which sections are expanded. While collapsed the header shows a
 * one-line summary (orange when active); heavy controls only mount when open.
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
  /** Shared `?` concept for this filter. Omit for filter-only controls. */
  concept?: Concept;
  summary: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  // The header is a row because the `?` is its own button (no nesting). The
  // title and the summary/chevron each toggle; the summary toggle grows into the
  // rest of the row, so on a phone only the `?` is not a toggle.
  //
  // The padding and `TAP_STEP` sit on the buttons, not the row, so each button
  // measures 36px below `sm` and the row takes its height from them.
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

/** "Any", a single value, or "first +N". */
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

/** Range summary from two optional ISO dates ("" = open). */
export function rangeSummary(from: string, to: string): string {
  if (!from && !to) return "Any";
  return `${from ? fmtMonth(from) : "…"} – ${to ? fmtMonth(to) : "…"}`;
}
