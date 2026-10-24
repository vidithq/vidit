"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { apiFetch } from "@/lib/api";
import { useApiResource } from "@/hooks/useApiResource";
import { TagPicker } from "@/components/ui/TagPicker";
import { TaxonomyLoadError } from "@/components/geolocations/TaxonomyLoadError";
import type { Conflict, Tag } from "@/types";

/**
 * The tag and conflict block the event forms carry: the two taxonomy fetches, the conflicts'
 * retryable failure banner, and the `TagPicker`.
 *
 * `useTaxonomy` owns the fetches and says whether the taxonomy is usable (the forms need the
 * conflicts before the floor can be judged); `TaxonomyFields` renders it. The form keeps the
 * selection state. The source editors read the same tag list.
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

  // Stable reference: `?? []` would mint a new array each render.
  const conflicts = useMemo(() => conflictsData ?? [], [conflictsData]);

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

  return { conflicts, blockedMessage, tags, setTags, reloadConflicts, conflictsError };
}

export function TaxonomyFields({
  taxonomy,
  selectedTagIds,
  setSelectedTagIds,
  selectedConflictIds,
  setSelectedConflictIds,
  conflictInvalid,
}: {
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** Flag the conflict group blocking publish (red label + outline). */
  conflictInvalid?: boolean;
}) {
  return (
    <>
      {taxonomy.conflictsError && <TaxonomyLoadError onRetry={taxonomy.reloadConflicts} />}
      <TagPicker
        tags={taxonomy.tags}
        setTags={taxonomy.setTags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        conflicts={taxonomy.conflicts}
        selectedConflictIds={selectedConflictIds}
        setSelectedConflictIds={setSelectedConflictIds}
        conflictInvalid={conflictInvalid}
      />
    </>
  );
}
