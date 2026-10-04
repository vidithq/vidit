"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/api";
import { fetchCollectionSequence } from "@/lib/collections";
import type { EventListItem } from "@/types";

interface SequenceResult {
  items: EventListItem[] | null;
  error: string | null;
  // Which collection this result answers; a result kept across an id change is stale.
  id: string | null;
}

/** A collection's items in reading order, walked once: `useApiResource`'s shape over several
 * requests (the `Link: rel="next"` walk), aborted on unmount and id change, skipped while `id`
 * is empty. `items` is null until the walk lands. Both collection pages use it so pins, panel
 * and rows describe one set; the edit page also diffs its save against it. */
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
    // An empty id reads as loading: route params are still resolving.
    loading: fresh === null,
  };
}
