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
import { FieldLabel } from "@/components/ui/FieldLabel";
import { EVENT_FIELDS } from "@/lib/events";

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
          selected={selectedConflictIds}
          setSelected={setSelectedConflictIds}
          invalid={conflictInvalid}
        />
      )}

      <TagsField
        tags={tags}
        setTags={setTags}
        selected={selectedTagIds}
        setSelected={setSelectedTagIds}
      />
    </>
  );
}

/** A form's **Tags** field: its label over `<TagChips>`. The Details card and each source editor
 *  carry it. */
export function TagsField({
  tags,
  setTags,
  selected,
  setSelected,
  owner,
}: {
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  selected: string[];
  setSelected: (next: string[]) => void;
  owner?: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel {...EVENT_FIELDS.tags} />
      <TagChips
        tags={tags}
        setTags={setTags}
        selected={selected}
        setSelected={setSelected}
        owner={owner}
      />
    </div>
  );
}

/** The picks of a catalogue field, each a chip that removes it, over the field's search. */
function PickedPills({
  picked,
  onRemove,
}: {
  picked: { id: string; label: string }[];
  onRemove: (id: string) => void;
}) {
  if (picked.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {picked.map(({ id, label }) => (
        <Pill key={id} tone="accent" onClick={() => onRemove(id)}>
          <span className="sr-only">Remove {label}</span>
          <span aria-hidden>{label}</span>
          <X size={12} aria-hidden />
        </Pill>
      ))}
    </div>
  );
}

/** A filter's picks: every value it holds, one its catalogue lacks (a crafted URL) shown as is. */
function filterPicks<T extends { name: string }>(
  names: string[],
  catalogue: T[],
  label: (item: T) => string,
) {
  return names.map((n) => {
    const known = catalogue.find((item) => item.name === n);
    return { id: n, label: known ? label(known) : n };
  });
}

type TagOption = { tag: Tag } | { create: string };

const tagOptionKey = (option: TagOption) =>
  "tag" in option ? option.tag.id : `create:${option.create}`;

type TagChipsProps = {
  tags: Tag[];
  /** Tag ids on a form, tag names on a filter. */
  selected: string[];
  setSelected: (next: string[]) => void;
  /** Names whose tags these are ("Source 2"), so several pickers on one page read apart. */
  owner?: string;
} & (
  | { filter?: false; setTags: Dispatch<SetStateAction<Tag[]>> }
  /** Picks by name from the catalogue it is given, with no Create row. */
  | { filter: true; setTags?: never }
);

/**
 * The tags picked from the one catalogue that serves events and sources: the picks as removable
 * chips over a combobox that suggests the other tags matching the typed text and, on a form, when
 * no tag bears that exact name, offers to create it. The event's Details card, each source editor
 * and the event filter panel render it.
 */
export function TagChips({ tags, selected, setSelected, owner, filter, setTags }: TagChipsProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const name = query.trim();
  const key = (tag: Tag) => (filter ? tag.name : tag.id);

  const select = (tag: Tag) => {
    if (!selected.includes(key(tag))) setSelected([...selected, key(tag)]);
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
        setTags?.((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
        select(created);
      },
    }
  );

  const picked = filter
    ? filterPicks(selected, tags, (t) => t.name)
    : tags.filter((t) => selected.includes(t.id)).map((t) => ({ id: t.id, label: t.name }));
  const needle = name.toLowerCase();
  const matches = tags.filter(
    (t) => !selected.includes(key(t)) && t.name.toLowerCase().includes(needle)
  );
  // Exact and case-sensitive, like the backend uniqueness rule.
  const canCreate = !filter && name !== "" && !tags.some((t) => t.name === name);
  const options: TagOption[] = [
    ...matches.map((tag) => ({ tag })),
    ...(canCreate ? [{ create: name }] : []),
  ];
  const label = owner ? `${owner} tags` : "Tags";

  return (
    <div className="space-y-2">
      <PickedPills
        picked={picked}
        onRemove={(removed) => setSelected(selected.filter((k) => k !== removed))}
      />
      <Combobox
        aria-label={label}
        placeholder={filter ? "Search tags" : "Search or create a tag"}
        maxLength={filter ? undefined : TAG_NAME_MAX_LEN}
        // A form field spans its card like every other field; the filter panel keeps it narrow.
        className={filter ? "max-w-xs" : undefined}
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
            : filter
              ? "No tags match."
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
 * The conflicts picked from a catalogue filtered client-side: the picks as removable chips over a
 * combobox that lists the conflicts matching the typed text, by tier then name
 * (`sortConflicts`), with "Other" pinned last.
 *
 * On a form the catalogue is the referential and the field draws its own label. The list holds
 * the ongoing conflicts and "Other" whatever its state; the "Include ended conflicts" switch adds
 * the ended ones. A pick stays on show when the switch drops its state. The switch sits on the
 * label row, out of the way of a list that opens below the field.
 *
 * On a filter the catalogue is the conflicts in use, every one offered, and the filter panel draws
 * the section title.
 */
export function ConflictChips({
  conflicts,
  selected,
  setSelected,
  invalid = false,
  filter = false,
}: {
  conflicts: Conflict[];
  /** Conflict ids on a form, conflict names on a filter. */
  selected: string[];
  setSelected: (next: string[]) => void;
  /** Flags the conflict blocking publish (red label and outline). */
  invalid?: boolean;
  /** Picks by name, with no label row and no switch. */
  filter?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [includeEnded, setIncludeEnded] = useState(false);
  const key = (c: Conflict) => (filter ? c.name : c.id);
  const offersEnded = filter || includeEnded;

  const select = (c: Conflict) => {
    if (!selected.includes(key(c))) setSelected([...selected, key(c)]);
    setQuery("");
  };

  const picked = filter
    ? filterPicks(selected, conflicts, conflictLabel)
    : conflicts
        .filter((c) => selected.includes(c.id))
        .map((c) => ({ id: c.id, label: conflictLabel(c) }));
  const needle = query.trim().toLowerCase();
  const options = sortConflicts(
    conflicts.filter(
      (c) =>
        !selected.includes(key(c)) &&
        (offersEnded || c.is_ongoing || c.name === CONFLICT_OTHER_NAME) &&
        c.name.toLowerCase().includes(needle)
    )
  );

  const field = (
    <div className="space-y-2">
      <PickedPills
        picked={picked}
        onRemove={(removed) => setSelected(selected.filter((k) => k !== removed))}
      />
      <Combobox
        aria-label={EVENT_FIELDS.conflicts.label}
        placeholder="Search conflicts"
        invalid={invalid}
        className={filter ? "max-w-xs" : undefined}
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        options={options}
        optionKey={(c) => c.id}
        renderOption={conflictLabel}
        pillOption={() => true}
        onPick={select}
        status={
          options.length > 0
            ? null
            : offersEnded
              ? "No conflicts match."
              : "No conflicts match; try including ended conflicts."
        }
      />
    </div>
  );
  if (filter) return field;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <FieldLabel {...EVENT_FIELDS.conflicts} invalid={invalid} />
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
      {field}
    </div>
  );
}
