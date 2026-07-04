/**
 * A browser-local string preference reflected onto `<html data-*>`: the shared
 * plumbing behind the accent palette (`data-palette`) and the light / dark
 * theme (`data-theme`). Both are the same shape: a `localStorage` value,
 * validated on read, mirrored onto a root `dataset` attribute that CSS keys
 * off, and broadcast on a custom event so every live `useClientPreference`
 * reader in the tab updates (the native `storage` event only fires in *other*
 * tabs).
 *
 * A display choice like these lives in `localStorage` rather than the server
 * profile: it follows the browser, costs no request, and works for logged-out
 * readers too.
 */

export interface AttributePreference<T extends string> {
  /** The stored value, or the fallback when absent / invalid / server-side. */
  get(): T;
  /** Persist, reflect onto `<html>`, and notify readers in this tab. */
  set(value: T): void;
  /** Reflect a value onto `<html data-*>` without persisting (pre-paint). */
  apply(value: T): void;
  /** The custom event name a reader subscribes to. */
  readonly event: string;
  /** The value returned when nothing valid is stored. */
  readonly fallback: T;
}

export function createAttributePreference<T extends string>(config: {
  /** `localStorage` key, e.g. `vidit:palette`. */
  key: string;
  /** `<html>` dataset key, e.g. `palette` (renders as `data-palette`). */
  attribute: string;
  /** Custom event dispatched on change, e.g. `vidit:palette-changed`. */
  event: string;
  /** Value returned when nothing valid is stored. */
  fallback: T;
  /** Narrows an arbitrary stored string to a known value. */
  isValid: (value: string | null) => value is T;
}): AttributePreference<T> {
  const { key, attribute, event, fallback, isValid } = config;

  function get(): T {
    if (typeof window === "undefined") return fallback;
    const stored = window.localStorage.getItem(key);
    return isValid(stored) ? stored : fallback;
  }

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

  return { get, set, apply, event, fallback };
}
