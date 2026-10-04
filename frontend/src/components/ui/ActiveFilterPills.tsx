import type { ReactNode } from "react";
import { X } from "lucide-react";

import { TAP_STEP } from "./Button";
import { Pill } from "./Pill";

/** `key` must be unique across the row (e.g. `conflict:<name>`). */
export interface ActiveFilter {
  key: string;
  label: string;
  icon?: ReactNode;
  onRemove: () => void;
}

/**
 * The one rendering of active filters: a row of removable accent chips, shared by
 * the map's filter overlay and the search page. `onClearAll` adds a clear
 * affordance once two or more are on.
 */
export function ActiveFilterPills({
  filters,
  onClearAll,
}: {
  filters: ActiveFilter[];
  onClearAll?: () => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <Pill
          key={f.key}
          tone="accent"
          icon={f.icon}
          title={`Remove filter: ${f.label}`}
          onClick={f.onRemove}
        >
          {f.label}
          <X size={11} />
        </Pill>
      ))}
      {onClearAll && filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className={`inline-flex items-center ${TAP_STEP} text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors`}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
