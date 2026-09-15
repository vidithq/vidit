"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/api";
import { fetchCollectionSequence } from "@/lib/collections";
import type { EventListItem } from "@/types";

interface SequenceResult {
  items: EventListItem[] | null;
  error: string | null;
  // Which collection this result answers. A result kept across an id change is
  // stale and must not leak into the new page state.
  id: string | null;
}

/**
 * A collection's items in reading order, walked once.
 *
 * `useApiResource`'s shape over a read that is several requests rather than
 * one path: the walk follows the `Link: rel="next"` cursor to the end, aborts
 * on unmount and on an id change, and is skipped while `id` is empty (route
 * params not ready). `items` is null until the walk lands, which is what
 * `loading` reports. A result carries the id it answers, so the items and the
 * error of the collection just left never render under the one just opened.
 *
 * Both collection pages take it, so neither reads the set its own way. The
 * collection's page draws its pins, its panel and its rows from the one
 * sequence, which is what keeps the three describing the same collection; the
 * edit page seeds its picker from it and diffs the save against it.
 */
export function useCollectionSequence(id: string): {
  items: EventListItem[] | null;
  error: string | null;
  loading: boolean;
} {
  const [result, setResult] = useState<SequenceResult>({
    items: null,
    error: null,
    id: null,
  });

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetchCollectionSequence(id, controller.signal)
      .then((walk) => {
        if (controller.signal.aborted) return;
        setResult({ items: walk, error: null, id });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          items: null,
          error: errorMessage(e, "Failed to read this collection"),
          id,
        });
      });
    return () => controller.abort();
  }, [id]);

  const fresh = result.id === id ? result : null;
  return {
    items: fresh ? fresh.items : null,
    error: fresh ? fresh.error : null,
    // An empty id reads as loading, not as an empty collection: the route
    // params are still resolving and the page has nothing to say yet.
    loading: fresh === null,
  };
}
