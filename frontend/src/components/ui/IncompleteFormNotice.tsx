import { AlertTriangle } from "lucide-react";

interface IncompleteFormNoticeProps {
  /** Human labels of every still-missing required field. Renders nothing when
   *  empty, so callers can mount it unconditionally. */
  missing: string[];
  /** Lead line above the list. Defaults to the submit/validate wording. */
  lead?: string;
}

/**
 * The one "this form isn't complete yet" message, shared by every create/edit
 * flow (geolocation submit, geolocation review-validate, bounty). It lists *all*
 * unmet requirements at once — not just the first — so the analyst fixes the
 * form in a single pass instead of playing whack-a-mole with one error at a time.
 *
 * Same design as `FORM_ERROR_BANNER` (red), but list-shaped, and it replays its
 * entrance animation each attempt: give it a `key` that changes per failed
 * submit (e.g. an attempt counter) so a repeat click visibly re-fires.
 */
export function IncompleteFormNotice({ missing, lead }: IncompleteFormNoticeProps) {
  if (missing.length === 0) return null;
  return (
    <div
      role="alert"
      className="animate-notice-in flex gap-3 rounded-md border border-red-700/60 bg-red-900/40 px-4 py-3 text-sm text-red-300"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
      <div className="space-y-1">
        <p className="font-medium">
          {lead ?? "Fill in the required fields before continuing:"}
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-red-300/90">
          {missing.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
