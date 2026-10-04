"use client";

import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { Conflict, Tag } from "@/types";
import {
  CONFLICT_OTHER_NAME,
  conflictLabel,
  sortConflicts,
} from "@/lib/conflicts";
import { useMutation } from "@/hooks/useMutation";
import { ApiError, apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";

// Mirrors `schemas/tag.py` `TagCreate.name` (the `String(100)` cap); change both.
const TAG_NAME_MAX_LEN = 100;

interface TagPickerProps {
  /** Live tags (referenced by at least one geolocation): the free-tag chips and
   *  the create-new dedup list. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** Curated taxonomy (`capture_source`), zero-usage rows included
   *  (`?curated=true`). */
  curatedTags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  /** `GET /conflicts` (~800 rows), filtered client-side. */
  conflicts: Conflict[];
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** Flag a group blocking submit (red label + outline). */
  conflictInvalid?: boolean;
  captureSourceInvalid?: boolean;
}

/**
 * Shared tag-selection section for the geolocation and request forms. Conflict
 * is a multi-select typeahead over the conflicts referential; capture source is
 * single-select from the curated taxonomy and hidden when none is passed; free
 * tags come from the live list.
 */
export function TagPicker({
  tags,
  setTags,
  curatedTags,
  selectedTagIds,
  setSelectedTagIds,
  conflicts,
  selectedConflictIds,
  setSelectedConflictIds,
  conflictInvalid = false,
  captureSourceInvalid = false,
}: TagPickerProps) {
  const invalidChips = "rounded-md p-2 ring-1 ring-red-500/40";
  const captureSourceTags = curatedTags.filter(
    (t) => t.category === "capture_source"
  );
  const freeTags = tags.filter((t) => t.category === "free");

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  // Single-valued (one lens per piece of media): radio-like, and clicking the
  // active chip clears it.
  const selectCaptureSource = (tagId: string) => {
    const captureIds = new Set(captureSourceTags.map((t) => t.id));
    setSelectedTagIds((prev) => {
      const withoutCapture = prev.filter((id) => !captureIds.has(id));
      return prev.includes(tagId) ? withoutCapture : [...withoutCapture, tagId];
    });
  };

  return (
    <Card as="section">
      <SectionHeading title="Classification" concept="section_classification" />

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

      {captureSourceTags.length > 0 && (
        <div className="space-y-2">
          <span
            className={`${FORM_LABEL}${captureSourceInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
          >
            Capture source <FieldHelp concept="capture_source" />
          </span>
          <div className={`flex flex-wrap gap-2${captureSourceInvalid ? ` ${invalidChips}` : ""}`}>
            {captureSourceTags.map((tag) => (
              <Pill
                key={tag.id}
                tone={selectedTagIds.includes(tag.id) ? "accent" : "neutral"}
                onClick={() => selectCaptureSource(tag.id)}
              >
                {tag.name}
              </Pill>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Free tags</span>
        {freeTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {freeTags.map((tag) => (
              <Pill
                key={tag.id}
                tone={selectedTagIds.includes(tag.id) ? "accent" : "neutral"}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </Pill>
            ))}
          </div>
        )}
        <NewTagInput
          existingTags={tags}
          onCreated={(tag) => {
            setTags((prev) =>
              prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]
            );
            setSelectedTagIds((prev) =>
              prev.includes(tag.id) ? prev : [...prev, tag.id]
            );
          }}
        />
      </div>
    </Card>
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
    (c) => !selectedIds.includes(c.id) && (includeEnded || c.ongoing)
  );
  // Empty input: major ongoing conflicts plus the "Other" escape row, matched by
  // name alone so it is always offered.
  const matches = sortConflicts(
    q === ""
      ? conflicts.filter(
          (c) =>
            !selectedIds.includes(c.id) &&
            (c.name === CONFLICT_OTHER_NAME || (c.ongoing && c.tier === "major"))
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
          conflict{searchableBeyondDefault === 1 ? "" : "s"}, type to search.
        </p>
      )}
    </div>
  );
}

// Inline "create a free tag". `free` is the only category an analyst can create
// (`routers/tags.py::USER_CREATABLE_CATEGORIES`). A 409 (name exists,
// case-sensitive) shows a non-blocking message; the existing tag may be hidden
// from /tags by the orphan filter.
function NewTagInput({
  existingTags,
  onCreated,
}: {
  existingTags: Tag[];
  onCreated: (tag: Tag) => void;
}) {
  const [name, setName] = useState("");

  const trimmed = name.trim();

  const create = useMutation(
    () =>
      apiFetch<Tag>("/tags", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, category: "free" }),
      }),
    {
      fallback: "Could not create tag.",
      onError: (e) => {
        // A non-API throw (network TypeError) shows the fixed message, not a
        // raw "Failed to fetch".
        if (e instanceof ApiError && e.status === 409) {
          return "That tag already exists.";
        }
        if (e instanceof ApiError) {
          return e.message;
        }
        return "Could not create tag.";
      },
      onSuccess: (created) => {
        onCreated(created);
        setName("");
      },
    }
  );

  const busy = create.loading;
  const error = create.error;
  const canSubmit = !busy && trimmed.length > 0;

  async function submit() {
    if (!canSubmit) return;

    // Already local: skip the round-trip and select. Exact and case-sensitive,
    // like the backend uniqueness rule.
    const local = existingTags.find(
      (t) => t.name === trimmed && t.category === "free",
    );
    if (local) {
      create.setError(null);
      onCreated(local);
      setName("");
      return;
    }

    await create.run();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) create.setError(null);
          }}
          onKeyDown={onKeyDown}
          disabled={busy}
          maxLength={TAG_NAME_MAX_LEN}
          placeholder="New free tag (e.g. drone)"
          aria-label="New free tag name"
          className="flex-1 max-w-xs"
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          + Add
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
