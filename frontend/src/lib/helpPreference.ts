/**
 * Display preference: whether the `?` field-help affordances (see `FieldHelp`) are hidden.
 * The signed-in analyst's value lives on the server as `help_tooltips` and follows the account
 * (`lib/preferences.ts`); `localStorage` is the local cache every reader reads synchronously.
 */
const KEY = "vidit:help-hidden";
export const HELP_PREF_EVENT = "vidit:help-hidden-changed";

// Unset reads as shown. Mirrors backend schemas/preferences.DISPLAY_DEFAULTS; change both.
export function getHelpHidden(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

/** The choice this browser saved, or `null` when it saved none. */
export function getSavedHelpHidden(): boolean | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(KEY);
  return stored === "1" ? true : stored === "0" ? false : null;
}

export function clearHelpHidden(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(HELP_PREF_EVENT));
}

export function setHelpHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, hidden ? "1" : "0");
  // Notify live readers in this tab; the native `storage` event only fires in other tabs.
  window.dispatchEvent(new Event(HELP_PREF_EVENT));
}
