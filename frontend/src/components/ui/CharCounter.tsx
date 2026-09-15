/**
 * The room left in a capped free-text field: `remaining / cap`, red once the
 * value runs over.
 *
 * One counter for every field that carries a cap the writer has to stay under
 * (the profile bio, a collection's title and its description), so the same
 * reading cannot end up spelled three ways in three forms. It states what is
 * left rather than what is used, because that is the figure a writer acts on,
 * and it goes red exactly when the submit refuses the value, so the colour and
 * the disabled button always agree.
 *
 * It renders the figure alone, with no label and no box: a caller puts it where
 * the field's label sits, usually at the far end of that row.
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
