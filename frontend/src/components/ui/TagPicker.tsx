"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Tag } from "@/types";
import { NewTagInput } from "@/components/ui/NewTagInput";
import { Pill } from "@/components/ui/Pill";
import FieldHelp from "@/components/ui/FieldHelp";
import { OptionalHint } from "@/components/ui/OptionalHint";
import { FORM_LABEL } from "@/components/ui/form-styles";
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
 * Shared tag-selection section for the geolocation + bounty submit forms.
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
          <span className={`${FORM_LABEL}${conflictInvalid ? " !text-red-400" : ""}`}>
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
          <span className={`${FORM_LABEL}${captureSourceInvalid ? " !text-red-400" : ""}`}>
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
