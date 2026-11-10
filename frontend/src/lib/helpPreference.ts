import { createAttributePreference } from "./attributePreference";

/**
 * Display preference: whether the `?` field-help affordances (see `FieldHelp`) are hidden.
 * The signed-in analyst's value lives on the server as `help_tooltips` and follows the account
 * (`lib/preferences.ts`); `localStorage` is the local cache every reader reads synchronously.
 */
export const HELP_PREF_EVENT = "vidit:help-hidden-changed";

type Stored = "1" | "0";

// Unset reads as shown. Mirrors backend schemas/preferences.DISPLAY_DEFAULTS; change both.
const pref = createAttributePreference<Stored>({
  key: "vidit:help-hidden",
  event: HELP_PREF_EVENT,
  fallback: "0",
  isValid: (value): value is Stored => value === "1" || value === "0",
});

export function getHelpHidden(): boolean {
  return pref.get() === "1";
}

/** The choice this browser saved, or `null` when it saved none. */
export function getSavedHelpHidden(): boolean | null {
  const saved = pref.saved();
  return saved === null ? null : saved === "1";
}

export const clearHelpHidden = pref.clear;

export function setHelpHidden(hidden: boolean): void {
  pref.set(hidden ? "1" : "0");
}
