/**
 * A browser-local string preference reflected onto `<html data-*>`, shared by the accent
 * palette and the theme: a validated `localStorage` value mirrored onto a root `dataset`
 * attribute CSS keys off, and broadcast on a custom event so every `useClientPreference`
 * reader in the tab updates (the native `storage` event only fires in other tabs). It lives
 * in `localStorage` rather than the profile: it follows the browser, costs no request, and
 * works logged out.
 */

export interface AttributePreference<T extends string> {
  /** The stored value, or the fallback when absent / invalid / server-side. */
  get(): T;
  set(value: T): void;
}

export function createAttributePreference<T extends string>(config: {
  key: string;
  /** camelCase `dataset` key, not the attribute name (`colorScheme` for `data-color-scheme`);
   *  a literal `data-*` string writes the wrong attribute. */
  attribute: string;
  event: string;
  fallback: T;
  isValid: (value: string | null) => value is T;
}): AttributePreference<T> {
  const { key, attribute, event, fallback, isValid } = config;

  function get(): T {
    if (typeof window === "undefined") return fallback;
    const stored = window.localStorage.getItem(key);
    return isValid(stored) ? stored : fallback;
  }

  // Reflect without persisting. The pre-paint reflection is the inline script in the root layout.
  function apply(value: T): void {
    if (typeof document === "undefined") return;
    document.documentElement.dataset[attribute] = value;
  }

  function set(value: T): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
    apply(value);
    window.dispatchEvent(new Event(event));
  }

  return { get, set };
}
