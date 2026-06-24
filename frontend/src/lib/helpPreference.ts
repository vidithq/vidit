/**
 * Client-side display preference: whether the `?` field-help affordances
 * (see `FieldHelp`) are hidden. A pure display toggle, so it lives in
 * `localStorage` rather than the user's server-side profile — it follows the
 * browser, costs no request, and works for logged-out readers too.
 */
const KEY = "vidit:help-hidden";
export const HELP_PREF_EVENT = "vidit:help-hidden-changed";

export function getHelpHidden(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

export function setHelpHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, hidden ? "1" : "0");
  // Notify every live `FieldHelp` / settings toggle in this tab; the native
  // `storage` event only fires in *other* tabs.
  window.dispatchEvent(new Event(HELP_PREF_EVENT));
}
