"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Tag } from "@/types";
import { NewTagInput } from "@/components/ui/NewTagInput";
import { TagChip } from "@/components/ui/TagChip";
import { FORM_LABEL } from "@/components/ui/form-styles";

/**
 * Muted "required" marker. Deliberately neutral, not orange: the palette
 * rule reserves orange for clickable affordances, and a label hint isn't
 * one.
 */
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
  /** Show the "required" hint on the conflict / capture-source group.
   *  The selectors always render; enforcement (if any) lives in the
   *  parent's submit handler. */
  requireConflict?: boolean;
  requireCaptureSource?: boolean;
}

/**
 * Shared tag-selection section for the geolocation + bounty submit forms.
 *
 * Conflict (multi-select) and capture source (single-select — one original
 * lens per piece of media) come from the curated taxonomy; free tags + the
 * create-new input come from the live list. Both forms render *this* so
 * they can't drift apart — only `subtitle` and the `require*` flags differ.
 * The capture-source group simply doesn't render when no `capture_source`
 * tags exist, so a form that doesn't want it just passes curated tags
 * without that category.
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
        <h2 className="text-sm font-medium text-neutral-200">Tags</h2>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </header>

      {conflictTags.length > 0 && (
        <div className="space-y-2">
          <span className={FORM_LABEL}>
            Conflict {requireConflict && <RequiredHint />}
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
            Capture source {requireCaptureSource && <RequiredHint />}
          </span>
          <p className="text-xs text-neutral-500">
            The original lens that captured the media.
          </p>
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
