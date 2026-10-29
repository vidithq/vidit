"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Conflict, Tag } from "@/types";
import { CONFLICT_OTHER_NAME, conflictLabel, sortConflicts } from "@/lib/conflicts";
import { useMutation } from "@/hooks/useMutation";
import { ApiError, apiFetch } from "@/lib/api";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { EVENT_FIELDS } from "@/lib/events";
import { FieldError } from "./ErrorNotice";
import { OptionSearch } from "./OptionSearch";

// Mirrors `schemas/tag.py` `TagCreate.name` (the `String(100)` cap); change both.
const TAG_NAME_MAX_LEN = 100;

interface TagPickerProps {
  /** Live tags (referenced by at least one event or source) plus the ones created here: the
   *  chips and the create-new dedup list. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** `GET /tags/suggested`: the tags the field offers in one click. */
  suggestedTags?: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  /** `GET /conflicts` (~800 rows), filtered client-side. */
  conflicts: Conflict[];
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** Flag the conflict group blocking submit (red label + outline). */
  conflictInvalid?: boolean;
}

/**
 * The classification fields of the event forms, for the Details card: the conflicts, then the
 * tags.
 */
export function TagPicker({
  tags,
  setTags,
  suggestedTags,
  selectedTagIds,
  setSelectedTagIds,
  conflicts,
  selectedConflictIds,
  setSelectedConflictIds,
  conflictInvalid = false,
}: TagPickerProps) {
  return (
    <>
      {conflicts.length > 0 && (
        <ConflictsField
          conflicts={conflicts}
          selected={selectedConflictIds}
          setSelected={setSelectedConflictIds}
          invalid={conflictInvalid}
        />
      )}

      <TagsField
        tags={tags}
        setTags={setTags}
        suggested={suggestedTags}
        selected={selectedTagIds}
        setSelected={setSelectedTagIds}
      />
    </>
  );
}

/** A form's **Tags** field: its label over an `<OptionSearch>` of the one tag catalogue that serves
 *  events and sources, which offers to create a tag no tag names exactly (case-sensitive, like
 *  the backend uniqueness rule) and suggests tags in one click. The Details card and each source
 *  editor carry it; `owner` names the source ("Source 2") so several fields read apart. */
export function TagsField({
  tags,
  setTags,
  suggested = [],
  selected,
  setSelected,
  owner,
}: {
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  suggested?: Tag[];
  selected: string[];
  setSelected: (next: string[]) => void;
  owner?: string;
}) {
  // A suggestion may not be in the catalogue yet: `/tags` and `/tags/suggested` load apart.
  const pick = (next: string[]) => {
    const added = suggested.filter((t) => next.includes(t.id) && !tags.some((x) => x.id === t.id));
    if (added.length > 0) setTags((prev) => [...prev, ...added]);
    setSelected(next);
  };
  // A 409 (name exists, case-sensitive) shows a non-blocking message; the existing tag may be
  // hidden from /tags by the orphan filter.
  const create = useMutation(
    (tagName: string) =>
      apiFetch<Tag>("/tags", { method: "POST", body: JSON.stringify({ name: tagName }) }),
    {
      fallback: "Could not create tag.",
      onError: (e) =>
        e instanceof ApiError && e.status === 409 ? "That tag already exists." : undefined,
      onSuccess: (tag) => {
        setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
        setSelected([...selected, tag.id]);
      },
    },
  );
  return (
    <div className="space-y-1.5">
      <FieldLabel {...EVENT_FIELDS.tags} />
      <OptionSearch
        aria-label={owner ? `${owner} tags` : "Tags"}
        placeholder="Search tags"
        options={tags.map(tagOption)}
        selected={selected}
        onChange={pick}
        creatable={{
          maxLength: TAG_NAME_MAX_LEN,
          onCreate: (name) => {
            if (!create.loading) void create.run(name);
          },
        }}
        suggestions={suggested.map(tagOption)}
        onQueryChange={() => {
          if (create.error) create.setError(null);
        }}
      />
      <FieldError alert>{create.error}</FieldError>
    </div>
  );
}

const tagOption = (t: Tag) => ({ value: t.id, label: t.name });

/**
 * The conflicts picked from the referential, filtered client-side, by tier then name
 * (`sortConflicts`), with "Other" pinned last. The list holds the ongoing conflicts and "Other"
 * whatever its state; the Include ended conflicts switch adds the ended ones.
 */
function ConflictsField({
  conflicts,
  selected,
  setSelected,
  invalid,
}: {
  conflicts: Conflict[];
  selected: string[];
  setSelected: (next: string[]) => void;
  invalid: boolean;
}) {
  const ended = new Set(
    conflicts.filter((c) => !c.is_ongoing && c.name !== CONFLICT_OTHER_NAME).map((c) => c.id),
  );
  return (
    <div className="space-y-1.5">
      <FieldLabel {...EVENT_FIELDS.conflicts} invalid={invalid} />
      <OptionSearch
        aria-label={EVENT_FIELDS.conflicts.label}
        placeholder="Search conflicts"
        options={sortConflicts(conflicts).map((c) => ({ value: c.id, label: conflictLabel(c) }))}
        selected={selected}
        onChange={setSelected}
        includeEnded={{ isEnded: (id) => ended.has(id), label: "Include ended conflicts" }}
        invalid={invalid}
      />
    </div>
  );
}
