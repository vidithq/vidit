import { Pill } from "./Pill";

/**
 * A multi-select chip bucket for one filter family (conflicts, capture
 * sources, tags, media types): every option is a pill, selected ones filled
 * accent, and clicking toggles membership. Within a bucket the semantics are
 * any-match (OR); combining buckets is the caller's contract (AND on the
 * server). Shared by the map's filter overlay and the search page.
 */
export function ChipBucket({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; name: string; label?: string }[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <Pill
          key={opt.id}
          tone={selected.includes(opt.name) ? "accent" : "neutral"}
          onClick={() => onToggle(opt.name)}
        >
          {opt.label ?? opt.name}
        </Pill>
      ))}
    </div>
  );
}
