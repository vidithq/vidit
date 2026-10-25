/**
 * How much of a capped free-text field is used: `length / cap`, red once the value runs over.
 * One counter for every capped field (the profile bio, a collection's title and description), so
 * each reads the same way. It goes red exactly when the submit refuses. A caller puts it where
 * the field's label sits.
 */
export function CharCounter({ length, max }: { length: number; max: number }) {
  return (
    <span className={`text-[11px] tabular-nums ${length > max ? "text-red-400" : "text-neutral-500"}`}>
      {length} / {max}
    </span>
  );
}
