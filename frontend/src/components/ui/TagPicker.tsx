"use client";

import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { Tag } from "@/types";
import { useMutation } from "@/hooks/useMutation";
import { ApiError, apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { OptionalHint } from "@/components/ui/OptionalHint";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface TagPickerProps {
  /** Live tags (referenced by ≥1 geolocation) — source of the free-tag chips
   *  and the create-new dedup list. */
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** Full curated taxonomy (`conflict` + `capture_source`), including
   *  zero-usage rows — fetched with `?curated=true`. */
  curatedTags: Tag[];
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  /** Required-by-default: when false, the group shows an "optional" marker.
   *  Hint only — enforcement lives in the parent's submit handler. */
  requireConflict?: boolean;
  requireCaptureSource?: boolean;
  /** Flag a curated group as a missing required field (red label + outline)
   *  when the form's submit/validate was blocked on it. */
  conflictInvalid?: boolean;
  captureSourceInvalid?: boolean;
}

/**
 * Shared tag-selection section for the geolocation + request submit forms.
 * Both render *this* so they can't drift apart — only `subtitle` and the
 * `require*` flags differ. Conflict is multi-select, capture source single-
 * select (one lens per piece of media); both come from the curated taxonomy,
 * free tags from the live list. The capture-source group doesn't render when
 * no `capture_source` tags are passed.
 */
export function TagPicker({
  tags,
  setTags,
  curatedTags,
  selectedTagIds,
  setSelectedTagIds,
  requireConflict = false,
  requireCaptureSource = false,
  conflictInvalid = false,
  captureSourceInvalid = false,
}: TagPickerProps) {
  // Red label + ring around the chips when the group blocked a submit/validate.
  const invalidChips = "rounded-md p-2 ring-1 ring-red-500/40";
  const conflictTags = curatedTags.filter((t) => t.category === "conflict");
  const captureSourceTags = curatedTags.filter(
    (t) => t.category === "capture_source"
  );
  const freeTags = tags.filter((t) => t.category === "free");

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  // Capture source is single-valued — one original lens per piece of
  // media — so its chips behave like a radio group: picking one clears
  // any other capture-source pick. Clicking the active one clears it.
  const selectCaptureSource = (tagId: string) => {
    const captureIds = new Set(captureSourceTags.map((t) => t.id));
    setSelectedTagIds((prev) => {
      const withoutCapture = prev.filter((id) => !captureIds.has(id));
      return prev.includes(tagId) ? withoutCapture : [...withoutCapture, tagId];
    });
  };

  return (
    <Card as="section">
      <SectionHeading title="Tags" concept="section_tags" />

      {conflictTags.length > 0 && (
        <div className="space-y-2">
          <span className={`${FORM_LABEL}${conflictInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}>
            Conflict <FieldHelp concept="conflict" />{" "}
            {!requireConflict && <OptionalHint />}
          </span>
          <div className={`flex flex-wrap gap-2${conflictInvalid ? ` ${invalidChips}` : ""}`}>
            {conflictTags.map((tag) => (
              <Pill
                key={tag.id}
                tone={selectedTagIds.includes(tag.id) ? "accent" : "neutral"}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {captureSourceTags.length > 0 && (
        <div className="space-y-2">
          <span
            className={`${FORM_LABEL}${captureSourceInvalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
          >
            Capture source{" "}
            <FieldHelp concept="capture_source" />{" "}
            {!requireCaptureSource && <OptionalHint />}
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
        <span className={FORM_LABEL}>
          Free tags <OptionalHint />
        </span>
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

// Inline "create a free tag" affordance. `free` is the only category an
// analyst can create — `conflict` is admin-curated (see
// `backend/app/routers/tags.py::USER_CREATABLE_CATEGORIES`). Private to the
// TagPicker, its only consumer.
//
// 409 = name already exists in the DB (case-sensitive). Surfaced as a
// non-blocking message; the existing tag may be hidden from /tags because it
// has zero live geolocations (the orphan filter), but that's not worth a
// special path until it bites.
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
        // 409 = name already in the DB (case-sensitive). Other API errors
        // surface their message; a non-API throw (e.g. a network TypeError)
        // shows the fixed message, not a raw "Failed to fetch".
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

    // Already in the local list: skip the round-trip and auto-select. Matched
    // exact + case-sensitive (the backend uniqueness rule) so a near-match
    // casing isn't masked as an existing tag.
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
          maxLength={100}
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
