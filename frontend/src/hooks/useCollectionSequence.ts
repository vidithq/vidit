"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/api";
import { fetchCollectionSequence } from "@/lib/collections";
import type { EventListItem } from "@/types";

/**
 * A collection's items in reading order, walked once.
 *
 * `useApiResource`'s shape over a read that is several requests rather than
 * one path: the walk follows the `Link: rel="next"` cursor to the end, aborts
 * on unmount and on an id change, and is skipped while `id` is empty (route
 * params not ready). `items` is null until the walk lands, which is what
 * `loading` reports.
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
  const [items, setItems] = useState<EventListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetchCollectionSequence(id, controller.signal)
      .then((walk) => {
        if (controller.signal.aborted) return;
        setItems(walk);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(e, "Failed to read this collection"));
      });
    return () => controller.abort();
  }, [id]);

  return { items, error, loading: items === null && error === null };
}
