import { useState } from "react";

import type { MissingField, MissingFieldKey } from "@/lib/events";

/** State behind `IncompleteFormNotice` and the in-form red outlines, shared by every
 * create/edit form. `validationAttempt` re-keys the notice so a repeat blocked click replays
 * its entrance. */
export function useIncompleteForm() {
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const invalidKeys = new Set<MissingFieldKey>(missingFields.map((m) => m.key));

  /** Record the misses and re-fire the notice; call only with a non-empty list. */
  const flagIncomplete = (fields: MissingField[]) => {
    setMissingFields(fields);
    setValidationAttempt((n) => n + 1);
  };

  const clearIncomplete = () => setMissingFields([]);

  return {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
  };
}
