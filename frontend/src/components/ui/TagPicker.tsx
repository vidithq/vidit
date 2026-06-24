"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Tag } from "@/types";
import { NewTagInput } from "@/components/ui/NewTagInput";
import { TagChip } from "@/components/ui/TagChip";
import FieldHelp from "@/components/ui/FieldHelp";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { FIELD_HELP } from "@/lib/fieldHelp";

/** Muted "required" marker. Neutral, not orange: a label hint isn't clickable. */
function RequiredHint() {
  return (
    <span className="ml-1 text-[10px] normal-case tracking-normal text-neutral-500">
      required
    </span>
  );
}

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
  subtitle: ReactNode;
  /** Show the "required" hint. Hint only — enforcement lives in the
   *  parent's submit handler. */
  requireConflict?: boolean;
  requireCaptureSource?: boolean;
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
  subtitle,
  requireConflict = false,
  requireCaptureSource = false,
}: TagPickerProps) {
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
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Tags
          <FieldHelp text={FIELD_HELP.section_tags} label="What goes in Tags?" />
        </h2>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </header>

      {conflictTags.length > 0 && (
        <div className="space-y-2">
          <span className={FORM_LABEL}>
            Conflict <FieldHelp text={FIELD_HELP.conflict} label="What is the Conflict tag?" />{" "}
            {requireConflict && <RequiredHint />}
          </span>
          <div className="flex flex-wrap gap-2">
            {conflictTags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                active={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
              />
            ))}
          </div>
        </div>
      )}

      {captureSourceTags.length > 0 && (
        <div className="space-y-2">
          <span className={FORM_LABEL}>
            Capture source{" "}
            <FieldHelp text={FIELD_HELP.capture_source} label="What is the Capture source?" />{" "}
            {requireCaptureSource && <RequiredHint />}
          </span>
          <div className="flex flex-wrap gap-2">
            {captureSourceTags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                active={selectedTagIds.includes(tag.id)}
                onClick={() => selectCaptureSource(tag.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <span className={FORM_LABEL}>Free tags</span>
        {freeTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {freeTags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                active={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
              />
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
    </section>
  );
}
