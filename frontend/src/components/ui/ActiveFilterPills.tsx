import { Button } from "./Button";
import { Pill } from "./Pill";

/** `key` must be unique across the row (e.g. `conflicts:<name>`). */
export interface ActiveFilter {
  key: string;
  /** The filter's name, as its line in the panel reads (`Conflict`); a switch's pill reads as
   *  its name alone. */
  filter?: string;
  /** The value, as its chip reads. */
  label: string;
  onRemove: () => void;
}

/**
 * The one rendering of active filters: a row of removable accent chips, each a key/value pill
 * naming its filter: the phone's filter bar and the map's collapsed filter panel. `onClearAll`
 * adds the panel's **Clear all** button once two or more are on.
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
          label={f.filter}
          title={f.filter ? `Remove filter ${f.filter}: ${f.label}` : `Remove filter ${f.label}`}
          onRemove={f.onRemove}
        >
          {f.label}
        </Pill>
      ))}
      {onClearAll && filters.length > 1 && (
        <Button action="remove" variant="ghost" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
