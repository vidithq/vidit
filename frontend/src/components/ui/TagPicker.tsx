"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import type { Conflict, Tag } from "@/types";
import { CONFLICT_OTHER_NAME, conflictLabel, sortConflicts } from "@/lib/conflicts";
import { useMutation } from "@/hooks/useMutation";
import { ApiError, apiFetch } from "@/lib/api";
import { Combobox } from "@/components/ui/Combobox";
import { Pill } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";

// Mirrors `schemas/tag.py` `TagCreate.name` (the `String(100)` cap); change both.
const TAG_NAME_MAX_LEN = 100;

interface TagPickerProps {
  /** Live tags (referenced by at least one event or source) plus the ones created here: the
   *  chips and the create-new dedup list. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
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
 * tags as `<TagChips>`.
 */
export function TagPicker({
  tags,
  setTags,
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
        <ConflictChips
          conflicts={conflicts}
          selectedIds={selectedConflictIds}
          setSelectedIds={setSelectedConflictIds}
          invalid={conflictInvalid}
        />
      )}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Tags</span>
        <TagChips
          tags={tags}
          setTags={setTags}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
        />
      </div>
    </>
  );
}

type TagOption = { tag: Tag } | { create: string };

const tagOptionKey = (option: TagOption) =>
  "tag" in option ? option.tag.id : `create:${option.create}`;

/**
 * The tags picked from the one catalogue that serves events and sources: the picks as removable
 * chips over a combobox that suggests the other tags matching the typed text and, when no tag
 * bears that exact name, offers to create it. The event's Details card and each source editor
 * render it.
 */
export function TagChips({
  tags,
  setTags,
  selectedTagIds,
  setSelectedTagIds,
  owner,
}: {
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  selectedTagIds: string[];
  setSelectedTagIds: (next: string[]) => void;
  /** Names whose tags these are ("Source 2"), so several pickers on one page read apart. */
  owner?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const name = query.trim();

  const select = (tag: Tag) => {
    if (!selectedTagIds.includes(tag.id)) setSelectedTagIds([...selectedTagIds, tag.id]);
    setQuery("");
  };

  // A 409 (name exists, case-sensitive) shows a non-blocking message; the existing tag may be
  // hidden from /tags by the orphan filter.
  const create = useMutation(
    (tagName: string) =>
      apiFetch<Tag>("/tags", {
        method: "POST",
        body: JSON.stringify({ name: tagName }),
      }),
    {
      fallback: "Could not create tag.",
      onError: (e) => {
        // A non-API throw (network TypeError) shows the fixed message, not a raw "Failed to fetch".
        if (e instanceof ApiError && e.status === 409) return "That tag already exists.";
        if (e instanceof ApiError) return e.message;
        return "Could not create tag.";
      },
      onSuccess: (created) => {
        setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
        select(created);
      },
    }
  );

  const selected = tags.filter((t) => selectedTagIds.includes(t.id));
  const needle = name.toLowerCase();
  const matches = tags.filter(
    (t) => !selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(needle)
  );
  // Exact and case-sensitive, like the backend uniqueness rule.
  const canCreate = name !== "" && !tags.some((t) => t.name === name);
  const options: TagOption[] = [
    ...matches.map((tag) => ({ tag })),
    ...(canCreate ? [{ create: name }] : []),
  ];
  const label = owner ? `${owner} tags` : "Tags";

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((tag) => (
            <Pill
              key={tag.id}
              tone="accent"
              onClick={() => setSelectedTagIds(selectedTagIds.filter((id) => id !== tag.id))}
            >
              <span className="sr-only">Remove {tag.name}</span>
              <span aria-hidden>{tag.name}</span>
              <X size={12} aria-hidden />
            </Pill>
          ))}
        </div>
      )}
      <Combobox
        aria-label={label}
        placeholder="Search or create a tag"
        maxLength={TAG_NAME_MAX_LEN}
        className="max-w-xs"
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          if (create.error) create.setError(null);
        }}
        open={open}
        onOpenChange={setOpen}
        options={options}
        optionKey={tagOptionKey}
        pillOption={(option) => "tag" in option}
        renderOption={(option) =>
          "tag" in option ? (
            option.tag.name
          ) : (
            <>
              <Plus size={14} aria-hidden className="shrink-0 text-neutral-500" />
              <span className="min-w-0 truncate">Create &quot;{option.create}&quot;</span>
            </>
          )
        }
        onPick={(option) => {
          if ("tag" in option) select(option.tag);
          else if (!create.loading) void create.run(option.create);
        }}
        status={
          options.length > 0
            ? null
            : name === ""
              ? "Type a name to create a tag."
              : "Already selected."
        }
      />
      {create.error && <p className="text-xs text-red-400">{create.error}</p>}
    </div>
  );
}

/**
 * The conflicts picked from the referential, filtered client-side: the picks as removable chips
 * over a combobox that lists the ongoing conflicts matching the typed text, by tier then name
 * (`sortConflicts`), with "Other" pinned last and offered whatever its state. The "Include ended
 * conflicts" switch adds the ended ones. A pick stays on show when the switch drops its state.
 * The switch sits on the label row, out of the way of a list that opens below the field.
 */
function ConflictChips({
  conflicts,
  selectedIds,
  setSelectedIds,
  invalid,
}: {
  conflicts: Conflict[];
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  /** Flags the conflict blocking publish (red label and outline). */
  invalid: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [includeEnded, setIncludeEnded] = useState(false);

  const select = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setQuery("");
  };

  const selected = conflicts.filter((c) => selectedIds.includes(c.id));
  const needle = query.trim().toLowerCase();
  const options = sortConflicts(
    conflicts.filter(
      (c) =>
        !selectedIds.includes(c.id) &&
        (includeEnded || c.is_ongoing || c.name === CONFLICT_OTHER_NAME) &&
        c.name.toLowerCase().includes(needle)
    )
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className={`${FORM_LABEL}${invalid ? ` ${FORM_INVALID_LABEL}` : ""}`}>
          Conflict <FieldHelp concept="conflict" />
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={includeEnded}
          onClick={() => setIncludeEnded((v) => !v)}
          className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-300 transition-colors"
        >
          <Switch as="span" size="sm" on={includeEnded} />
          Include ended conflicts
        </button>
      </div>
      <div className={cn("space-y-2", invalid && "rounded-md p-2 ring-1 ring-red-500/40")}>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((c) => (
              <Pill
                key={c.id}
                tone="accent"
                onClick={() => setSelectedIds((prev) => prev.filter((id) => id !== c.id))}
              >
                <span className="sr-only">Remove {conflictLabel(c)}</span>
                <span aria-hidden>{conflictLabel(c)}</span>
                <X size={12} aria-hidden />
              </Pill>
            ))}
          </div>
        )}
        <Combobox
          aria-label="Conflict"
          placeholder="Search conflicts"
          className="max-w-xs"
          query={query}
          onQueryChange={setQuery}
          open={open}
          onOpenChange={setOpen}
          options={options}
          optionKey={(c) => c.id}
          renderOption={conflictLabel}
          pillOption={() => true}
          onPick={(c) => select(c.id)}
          status={
            options.length > 0
              ? null
              : includeEnded
                ? "No conflicts match."
                : "No conflicts match; try including ended conflicts."
          }
        />
      </div>
    </div>
  );
}
