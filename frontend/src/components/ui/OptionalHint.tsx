/** Muted "optional" marker. The form convention is required-by-default — only
 *  the exceptions are marked. Neutral, not orange: a label hint isn't clickable. */
export function OptionalHint() {
  return (
    <span className="ml-1 text-[10px] normal-case tracking-normal text-neutral-500">
      optional
    </span>
  );
}
