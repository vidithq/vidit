"use client";

import { useClientPreference } from "./useClientPreference";

/** One JSON value in `localStorage`, read through `useClientPreference`. `parse` turns the stored
 *  JSON into a value, or `null` for one it refuses, which reads as `fallback`. Storage can be
 *  absent or throw (a private window, blocked site data): the value then lives in memory for the
 *  session. The snapshot keeps one value per stored string, as `useSyncExternalStore` requires. */
export function storedJson<T>(key: string, fallback: T, parse: (value: unknown) => T | null) {
  const event = `${key}-changed`;
  let current: { raw: string | null; value: T } = { raw: null, value: fallback };
  let memoryOnly = false;
  const read = (): T => {
    if (memoryOnly) return current.value;
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      memoryOnly = true;
      return current.value;
    }
    if (raw === current.raw) return current.value;
    let value = fallback;
    try {
      value = raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
    } catch {
      // An unreadable value reads as no value.
    }
    current = { raw, value };
    return value;
  };
  const write = (value: T) => {
    const raw = JSON.stringify(value);
    current = { raw, value };
    try {
      localStorage.setItem(key, raw);
    } catch {
      memoryOnly = true;
    }
    window.dispatchEvent(new Event(event));
  };
  const useValue = () => useClientPreference(read, event, () => fallback);
  return { read, write, event, useValue };
}
