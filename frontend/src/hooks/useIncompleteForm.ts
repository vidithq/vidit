import { useState } from "react";

import type { MissingField, MissingFieldKey } from "@/lib/events";

/**
 * The state behind `IncompleteFormNotice` + the in-form red outlines, shared by
 * every create/edit form (geolocation submit, request submit, review-validate) so
 * the wiring can't drift. Holds the current misses, exposes the `key` set the
 * fields highlight off, and a `validationAttempt` counter that re-keys the notice
 * so a repeat blocked click replays its entrance.
 */
export function useIncompleteForm() {
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const invalidKeys = new Set<MissingFieldKey>(missingFields.map((m) => m.key));

  /** Flag the form incomplete: record the misses and bump the attempt so the
   *  notice re-fires. Call only with a non-empty list (the caller checks). */
  const flagIncomplete = (fields: MissingField[]) => {
    setMissingFields(fields);
    setValidationAttempt((n) => n + 1);
  };

  /** Clear the misses — called at the top of each submit attempt. */
  const clearIncomplete = () => setMissingFields([]);

  return {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
  };
}
