import { AlertTriangle } from "lucide-react";

import { FORM_ERROR_BANNER } from "./form-styles";

interface IncompleteFormNoticeProps {
  /** Labels of every missing required field. Empty renders nothing. */
  missing: string[];
}

/**
 * The one "this form isn't complete yet" message, shared by every create/edit
 * flow. It lists all unmet requirements at once, so the analyst fixes the form in
 * one pass.
 *
 * `FORM_ERROR_BANNER` styling, list-shaped. It replays its entrance animation per
 * attempt: give it a `key` that changes per failed submit.
 */
export function IncompleteFormNotice({ missing }: IncompleteFormNoticeProps) {
  if (missing.length === 0) return null;
  return (
    <div
      role="alert"
      className={`animate-notice-in flex gap-3 ${FORM_ERROR_BANNER}`}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
      <div className="space-y-1">
        <p className="font-medium">
          Fill in the required fields before continuing:
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
