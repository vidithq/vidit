/**
 * The room left in a capped free-text field: `remaining / cap`, red once the
 * value runs over. One counter for every capped field (the profile bio, a
 * collection's title and description). It states what is left, since that is the
 * figure a writer acts on, and goes red exactly when the submit refuses. A
 * caller puts it where the field's label sits.
 */
export function CharCounter({ length, max }: { length: number; max: number }) {
  const remaining = max - length;
  return (
    <span
      className={`text-[11px] ${remaining < 0 ? "text-red-400" : "text-neutral-500"}`}
    >
      {remaining} / {max}
    </span>
  );
}
