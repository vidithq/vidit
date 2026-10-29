"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { apiFetch } from "@/lib/api";
import { useApiResource } from "@/hooks/useApiResource";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { conflictsByFrequency } from "@/lib/conflicts";
import { coordinatePair } from "@/lib/coordinates";
import { toBboxParam } from "@/lib/viewport";
import type { Conflict, EventListItem, Tag } from "@/types";
import type { ReadableError } from "@/lib/errors";

/**
 * The taxonomy fetches the event forms read: `useTaxonomy` owns them and says whether the
 * taxonomy is usable (the forms need the conflicts before the floor can be judged). The Details
 * card (`DetailsFields`) renders them; the form keeps the selection state. The source editors
 * read the same tag lists.
 */

export interface TaxonomyState {
  /** Fetched whole once (~800 rows), filtered client-side. */
  conflicts: Conflict[];
  /** Null once the conflicts are loaded; otherwise the message to surface. A pending or failed
   *  load is recoverable, not a missing field: judging the floor against an empty list would
   *  report the conflict missing. */
  blockedMessage: string | null;
  /** Live tags plus the pickers' local appends (a new tag lands without a refetch). */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** `GET /tags/suggested`, empty until loaded or when the load fails. */
  suggestedTags: Tag[];
  reloadConflicts: () => void;
  conflictsError: ReadableError | null;
}

export function useTaxonomy(): TaxonomyState {
  // useState, not useApiResource: the pickers append created tags via setTags.
  const [tags, setTags] = useState<Tag[]>([]);
  const {
    data: conflictsData,
    error: conflictsError,
    refetch: reloadConflicts,
  } = useApiResource<Conflict[]>("/conflicts");

  const { data: suggestedData } = useApiResource<Tag[]>("/tags/suggested");

  // Stable references: `?? []` would mint a new array each render.
  const conflicts = useMemo(() => conflictsData ?? [], [conflictsData]);
  const suggestedTags = useMemo(() => suggestedData ?? [], [suggestedData]);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  const blockedMessage =
    conflicts.length > 0
      ? null
      : conflictsError
        ? "Couldn’t load the required Conflict options. Use Retry above, or reload the page."
        : "Still loading the required Conflict options. Give it a moment and try again.";

  return {
    conflicts,
    blockedMessage,
    tags,
    setTags,
    suggestedTags,
    reloadConflicts,
    conflictsError,
  };
}

/** Wait after the coordinates last change before reading the events near them. */
const NEARBY_DEBOUNCE_MS = 500;

/** Half the side of the box around the point, in degrees: about 28 km of latitude. */
const NEARBY_SPAN_DEG = 0.25;

/** The page the read asks for: the server's cap. */
const NEARBY_LIMIT = 100;

/** The conflicts of the published events near the point the coordinates hold, the most frequent
 *  first, for the Conflict field's suggestions. Empty while the coordinates hold no valid pair or
 *  the read fails. */
export function useNearbyConflictIds(lat: string, lng: string): string[] {
  const point = coordinatePair(lat, lng);
  const key = point ? `${point.lat},${point.lng}` : "";
  const [ids, setIds] = useState<string[]>([]);
  useDebouncedEffect(
    () => {
      if (!point) {
        setIds([]);
        return;
      }
      const bbox = toBboxParam({
        south: point.lat - NEARBY_SPAN_DEG,
        west: point.lng - NEARBY_SPAN_DEG,
        north: point.lat + NEARBY_SPAN_DEG,
        east: point.lng + NEARBY_SPAN_DEG,
      });
      const controller = new AbortController();
      apiFetch<EventListItem[]>(`/events?status=geolocated&limit=${NEARBY_LIMIT}&bbox=${bbox}`, {
        signal: controller.signal,
      })
        .then((events) => setIds(conflictsByFrequency(events)))
        .catch(() => setIds([]));
      return () => controller.abort();
    },
    [key],
    NEARBY_DEBOUNCE_MS,
  );
  return ids;
}
