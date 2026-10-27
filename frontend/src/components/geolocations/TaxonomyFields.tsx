"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { apiFetch } from "@/lib/api";
import { useApiResource } from "@/hooks/useApiResource";
import type { Conflict, Tag } from "@/types";

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
  conflictsError: string | null;
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
