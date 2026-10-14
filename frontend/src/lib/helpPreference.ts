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

export function setHelpHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, hidden ? "1" : "0");
  // Notify live readers in this tab; the native `storage` event only fires in other tabs.
  window.dispatchEvent(new Event(HELP_PREF_EVENT));
}
