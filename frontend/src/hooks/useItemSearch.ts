"use client";

import { useState } from "react";

import { useDebouncedEffect } from "./useDebouncedEffect";

/** Not a fetch per keystroke, but up by the time typing stops. */
export const SEARCH_DEBOUNCE_MS = 250;

/** What a search resolves to: the rows, or the rows with a `note` that shows as a muted line (why
 *  a match is left out, how many more there are). */
export type Found<T> = T[] | { rows: T[]; note: string | null };

export type ItemSearchRun<T> = (query: string, signal: AbortSignal) => Promise<Found<T>>;

export interface ItemSearchAnswer<T> {
  rows: T[];
  note: string | null;
  loading: boolean;
  failed: boolean;
}

const IDLE = { rows: [], note: null, loading: false, failed: false };

/**
 * Runs `run` for `query` once typing rests, or at once for an empty query, while `enabled`. A
 * newer query aborts the request in flight, and an answer only shows while its query is the
 * current one.
 */
export function useItemSearch<T>(
  query: string,
  run: ItemSearchRun<T> | null,
  enabled: boolean,
): ItemSearchAnswer<T> {
  const [answer, setAnswer] = useState<{
    query: string;
    rows: T[] | null;
    note: string | null;
  } | null>(null);
  const active = enabled && run !== null;

  useDebouncedEffect(
    () => {
      if (!active) return;
      const controller = new AbortController();
      run(query, controller.signal).then(
        (found) => {
          if (controller.signal.aborted) return;
          setAnswer(
            Array.isArray(found)
              ? { query, rows: found, note: null }
              : { query, rows: found.rows, note: found.note },
          );
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ query, rows: null, note: null });
        },
      );
      return () => controller.abort();
    },
    [query, active],
    query ? SEARCH_DEBOUNCE_MS : 0,
  );

  if (!active) return IDLE;
  const current = answer?.query === query ? answer : null;
  if (!current) return { ...IDLE, loading: true };
  if (current.rows === null) return { ...IDLE, failed: true };
  return { rows: current.rows, note: current.note, loading: false, failed: false };
}
