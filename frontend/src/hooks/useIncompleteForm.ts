import { useState } from "react";

import { FORM_INVALID_LABEL } from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";
import type { MissingFieldKey } from "@/lib/events";

/** A required field a form is still missing (`MissingField` for the event forms); `key` drives
 * the in-form highlight. */
interface MissingEntry<K extends string = MissingFieldKey> {
  key: K;
  label: string;
}

/** The required fields whose value is blank after trimming, as `IncompleteFormAnnouncer` lists them. */
export function blankFields<K extends string>(
  fields: ReadonlyArray<{ key: K; label: string; value: string }>,
): MissingEntry<K>[] {
  return fields
    .filter((field) => field.value.trim() === "")
    .map(({ key, label }) => ({ key, label }));
}

/** State behind the in-form red outlines and `IncompleteFormAnnouncer`, shared by every
 * create/edit form. `validationAttempt` re-keys the announcer's sentence so a repeat blocked
 * click is read again. The event forms use the default key set; a form with its own fields (auth,
 * settings) passes its keys as `K`. */
export function useIncompleteForm<K extends string = MissingFieldKey>() {
  const [missingFields, setMissingFields] = useState<MissingEntry<K>[]>([]);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const invalidKeys = new Set<K>(missingFields.map((m) => m.key));

  /** Record the misses and re-fire the notice; call only with a non-empty list. */
  const flagIncomplete = (fields: MissingEntry<K>[]) => {
    setMissingFields(fields);
    setValidationAttempt((n) => n + 1);
  };

  const clearIncomplete = () => setMissingFields([]);

  /** `base` plus the red label state while `key` is flagged, so a label turns red with its field. */
  const labelClass = (key: K, base: string) =>
    cn(base, invalidKeys.has(key) && FORM_INVALID_LABEL);

  return {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
    labelClass,
  };
}
