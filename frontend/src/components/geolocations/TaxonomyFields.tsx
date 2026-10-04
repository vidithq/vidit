"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { apiFetch } from "@/lib/api";
import { useApiResource } from "@/hooks/useApiResource";
import { TagPicker } from "@/components/ui/TagPicker";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import type { Conflict, Tag } from "@/types";

/**
 * The tag and conflict block both geolocation forms carry: the three taxonomy
 * fetches, their retryable failure banners, and the `TagPicker`.
 *
 * `useTaxonomy` owns the fetches and says whether the taxonomy is usable (the
 * forms need the data before they render); `TaxonomyFields` renders it. The form
 * keeps the selection state.
 */

export interface TaxonomyState {
  /** Zero-usage rows included (`?curated=true`), so the first analyst to use a
   *  capture source can pick it. */
  curatedTags: Tag[];
  /** Fetched whole once (~800 rows), filtered client-side. */
  conflicts: Conflict[];
  /** Null once both curated lists are loaded; otherwise the message to surface.
   *  A pending or failed load is recoverable, not a missing field: judging the
   *  floor against an empty taxonomy would report both curated tags missing. */
  blockedMessage: string | null;
  /** Live free tags plus the picker's local appends (a new tag lands without a
   *  refetch). */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  reloadCuratedTags: () => void;
  reloadConflicts: () => void;
  curatedTagsError: string | null;
  conflictsError: string | null;
}

export function useTaxonomy(): TaxonomyState {
  // useState, not useApiResource: TagPicker appends created tags via setTags.
  const [tags, setTags] = useState<Tag[]>([]);
  const {
    data: curatedTagsData,
    error: curatedTagsError,
    refetch: reloadCuratedTags,
  } = useApiResource<Tag[]>("/tags?curated=true");
  const {
    data: conflictsData,
    error: conflictsError,
    refetch: reloadConflicts,
  } = useApiResource<Conflict[]>("/conflicts");

  // Stable references: `?? []` would mint a new array each render.
  const curatedTags = useMemo(() => curatedTagsData ?? [], [curatedTagsData]);
  const conflicts = useMemo(() => conflictsData ?? [], [conflictsData]);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  const blockedMessage =
    curatedTags.length > 0 && conflicts.length > 0
      ? null
      : curatedTagsError || conflictsError
        ? "Couldn’t load the required Conflict and Capture source options. Use Retry above, or reload the page."
        : "Still loading the required Conflict and Capture source options. Give it a moment and try again.";

  return {
    curatedTags,
    conflicts,
    blockedMessage,
    tags,
    setTags,
    reloadCuratedTags,
    reloadConflicts,
    curatedTagsError,
    conflictsError,
  };
}

export function TaxonomyFields({
  taxonomy,
  selectedTagIds,
  setSelectedTagIds,
  selectedConflictIds,
  setSelectedConflictIds,
  conflictInvalid,
  captureSourceInvalid,
}: {
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** Flag a group blocking publish (red label + outline). */
  conflictInvalid?: boolean;
  captureSourceInvalid?: boolean;
}) {
  return (
    <>
      {taxonomy.curatedTagsError && (
        <CuratedTagsError
          onRetry={taxonomy.reloadCuratedTags}
          message="Couldn't load the Capture source options."
        />
      )}
      {taxonomy.conflictsError && (
        <CuratedTagsError
          onRetry={taxonomy.reloadConflicts}
          message="Couldn't load the Conflict options."
        />
      )}
      <TagPicker
        tags={taxonomy.tags}
        setTags={taxonomy.setTags}
        curatedTags={taxonomy.curatedTags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        conflicts={taxonomy.conflicts}
        selectedConflictIds={selectedConflictIds}
        setSelectedConflictIds={setSelectedConflictIds}
        conflictInvalid={conflictInvalid}
        captureSourceInvalid={captureSourceInvalid}
      />
    </>
  );
}
