"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import type { Conflict, Tag } from "@/types";
import {
  CONFLICT_OTHER_NAME,
  conflictLabel,
  sortConflicts,
} from "@/lib/conflicts";
import { useMutation } from "@/hooks/useMutation";
import { ApiError, apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Pill } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { pluralNoun } from "@/lib/format";

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
 * The classification fields of the event forms, for the Details card: conflict, a multi-select
 * typeahead over the conflicts referential, then the tags as `<TagChips>`.
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
  const invalidChips = "rounded-md p-2 ring-1 ring-red-500/40";

  return (
    <>
      {conflicts.length > 0 && (
        <div className="space-y-2">
          <span className={`${FORM_LABEL}${conflictInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}>
            Conflict <FieldHelp concept="conflict" />
          </span>
          <div className={conflictInvalid ? invalidChips : undefined}>
            <ConflictTypeahead
              conflicts={conflicts}
              selectedIds={selectedConflictIds}
              setSelectedIds={setSelectedConflictIds}
            />
          </div>
        </div>
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
        renderOption={(option) =>
          "tag" in option ? (
            <span className="min-w-0 truncate">{option.tag.name}</span>
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

// Cap on the visible results; the empty-input default sits far under it.
const CONFLICTS_PREVIEW = 30;

/**
 * Multi-select typeahead over the conflicts referential, filtering client-side.
 * Empty input shows the major-tier ongoing conflicts with "Other" pinned last
 * and a hint counting the rest. Searching covers all ongoing conflicts; the
 * "Include ended conflicts" switch adds ended ones. Results sort by tier then
 * name (`sortConflicts`). Selected conflicts render as deselectable accent
 * pills above the input.
 *
 * Exported for surfaces that pick conflicts without the classification card
 * (the detections review flow); alongside tags, use `<TagPicker>`.
 */
export function ConflictTypeahead({
  conflicts,
  selectedIds,
  setSelectedIds,
}: {
  conflicts: Conflict[];
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [query, setQuery] = useState("");
  const [includeEnded, setIncludeEnded] = useState(false);

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // A selection survives the filters (an ended pick stays deselectable).
  const selected = conflicts.filter((c) => selectedIds.includes(c.id));

  const q = query.trim().toLowerCase();
  const searchable = conflicts.filter(
    (c) => !selectedIds.includes(c.id) && (includeEnded || c.is_ongoing)
  );
  // Empty input: major ongoing conflicts plus the "Other" escape row, matched by
  // name alone so it is always offered.
  const matches = sortConflicts(
    q === ""
      ? conflicts.filter(
          (c) =>
            !selectedIds.includes(c.id) &&
            (c.name === CONFLICT_OTHER_NAME || (c.is_ongoing && c.tier === "major"))
        )
      : searchable.filter((c) => c.name.toLowerCase().includes(q))
  );
  const visible = matches.slice(0, CONFLICTS_PREVIEW);
  const overflow = matches.length - visible.length;
  // Lets the switch show an effect before any keystroke.
  const searchableBeyondDefault = searchable.length - matches.length;

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((c) => (
            <Pill key={c.id} tone="accent" onClick={() => toggle(c.id)}>
              {conflictLabel(c)}
            </Pill>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conflicts"
          aria-label="Search conflicts"
          className="flex-1 min-w-40 max-w-xs"
        />
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
      {visible.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visible.map((c) => (
            <Pill key={c.id} tone="neutral" onClick={() => toggle(c.id)}>
              {conflictLabel(c)}
            </Pill>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          No conflicts match
          {includeEnded ? "." : "; try including ended conflicts."}
        </p>
      )}
      {overflow > 0 && (
        <p className="text-xs text-neutral-500">
          {overflow} more. Type to narrow the list.
        </p>
      )}
      {/* Not alongside the empty-state message. */}
      {q === "" && visible.length > 0 && searchableBeyondDefault > 0 && (
        <p className="text-xs text-neutral-500">
          {searchableBeyondDefault} more{includeEnded ? "" : " ongoing"}{" "}
          {pluralNoun(searchableBeyondDefault, "conflict")}, type to search.
        </p>
      )}
    </div>
  );
}
