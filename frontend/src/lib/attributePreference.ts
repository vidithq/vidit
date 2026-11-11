/**
 * A string preference reflected onto `<html data-*>`, shared by the accent palette and the
 * theme: a validated `localStorage` value mirrored onto a root `dataset` attribute CSS keys
 * off, and broadcast on a custom event so every `useClientPreference` reader in the tab updates
 * (the native `storage` event only fires in other tabs). The signed-in analyst's value lives on
 * the server and follows the account (`lib/preferences.ts`); `localStorage` is the cache the
 * pre-paint inline script reads, and the value a signed-out reader keeps.
 */

interface AttributePreference<T extends string> {
  /** The stored value, or the fallback when absent / invalid / server-side. */
  get(): T;
  /** The value this browser saved, or `null` when it saved none (or an invalid one). */
  saved(): T | null;
  set(value: T): void;
  /** Forget the saved value and drop the attribute, so the page reads the fallback. */
  clear(): void;
}

export function createAttributePreference<T extends string>(config: {
  key: string;
  /** camelCase `dataset` key, not the attribute name (`colorScheme` for `data-color-scheme`);
   *  a literal `data-*` string writes the wrong attribute. Omit it for a preference no CSS
   *  reads. */
  attribute?: string;
  event: string;
  fallback: T;
  isValid: (value: string | null) => value is T;
}): AttributePreference<T> {
  const { key, attribute, event, fallback, isValid } = config;
  // Storage can be absent or throw (a private window, blocked site data): the value then lives
  // in memory for the session.
  let memory: T | null = null;

  function saved(): T | null {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(key);
      return isValid(stored) ? stored : null;
    } catch {
      return memory;
    }
  }

  function get(): T {
    return saved() ?? fallback;
  }

  // Reflect without persisting. The pre-paint reflection is the inline script in the root layout.
  function apply(value: T): void {
    if (typeof document === "undefined" || attribute === undefined) return;
    document.documentElement.dataset[attribute] = value;
  }

  function set(value: T): void {
    if (typeof window === "undefined") return;
    memory = value;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // `memory` holds the value.
    }
    apply(value);
    window.dispatchEvent(new Event(event));
  }

  function clear(): void {
    if (typeof window === "undefined") return;
    memory = null;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // `memory` holds the value.
    }
    if (attribute !== undefined) delete document.documentElement.dataset[attribute];
    window.dispatchEvent(new Event(event));
  }

  return { get, saved, set, clear };
}
