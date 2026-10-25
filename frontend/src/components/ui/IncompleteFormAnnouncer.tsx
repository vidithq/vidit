/**
 * Tells a screen reader every required field a blocked submit left blank, in one sentence, on
 * each attempt. Nothing shows: the fields and their labels turn red in place, and a publish
 * button's `CountBadge` lists them. Shared by every create, edit and account form.
 *
 * The polite live region stays mounted, so each attempt's sentence is an addition it reads;
 * `attempt` re-keys the sentence, so a repeat attempt with the same blanks is read again.
 */
export function IncompleteFormAnnouncer({
  missing,
  attempt,
}: {
  /** Labels of every missing required field. */
  missing: string[];
  /** `useIncompleteForm`'s `validationAttempt`. */
  attempt: number;
}) {
  return (
    <div role="status" className="sr-only">
      {missing.length > 0 && (
        <p key={attempt}>Fill in the required fields before continuing: {missing.join(", ")}.</p>
      )}
    </div>
  );
}
