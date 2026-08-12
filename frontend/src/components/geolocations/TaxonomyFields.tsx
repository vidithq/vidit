"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { apiFetch } from "@/lib/api";
import { useApiResource } from "@/hooks/useApiResource";
import { TagPicker } from "@/components/ui/TagPicker";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import type { Conflict, Tag } from "@/types";

/**
 * The tag + conflict block both geolocation forms carry (submit and the
 * detection edit): the three taxonomy fetches, their retryable failure banners,
 * and the `TagPicker` itself. One home so the two forms can't drift on which
 * lists they load, what a failed load says, or when the floor can be judged.
 *
 * Split in two because the forms need the data before they render: `useTaxonomy`
 * owns the fetches and answers whether the taxonomy is usable, `TaxonomyFields`
 * renders it. The form keeps the selection state, since publishing is its job.
 */

export interface TaxonomyState {
  /** Full curated taxonomy, zero-usage rows included (`?curated=true`): the
   *  first analyst to use a capture source must still be able to pick it. */
  curatedTags: Tag[];
  /** The conflicts referential, fetched whole once (~800 rows) and filtered
   *  client-side by the picker's typeahead. */
  conflicts: Conflict[];
  /** Null once both curated lists are loaded and the publish floor can be
   *  judged; otherwise the message to surface. A pending or failed load is a
   *  recoverable state, not a missing field: judging the floor against an empty
   *  taxonomy would report both curated tags missing when the analyst picked
   *  nothing wrong. The two cases read differently (retry vs wait), and the
   *  failed one points at the banners `TaxonomyFields` renders. */
  blockedMessage: string | null;
  /** Live free tags plus the picker's local appends (a newly created tag lands
   *  here without a refetch). */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  reloadCuratedTags: () => void;
  reloadConflicts: () => void;
  curatedTagsError: string | null;
  conflictsError: string | null;
}

export function useTaxonomy(): TaxonomyState {
  // useState, not useApiResource: TagPicker appends newly created tags via
  // setTags, so the list is server-seeded but locally mutable.
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

  // Stable references (the `?? []` fallback would otherwise mint a new array
  // each render), so a caller's readiness memos don't recompute on unrelated
  // renders.
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
  /** Flag a curated group as a missing required field (red label + outline)
   *  when the form's publish was blocked on it. */
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
