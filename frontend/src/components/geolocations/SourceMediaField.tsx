"use client";

import type { ReactNode } from "react";

import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import FieldHelp from "@/components/ui/FieldHelp";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import type { Media } from "@/types";

interface SourceMediaFieldProps {
  /** Persisted media (edit / bounty-locked). [] for a fresh submit. */
  existing?: Media[];
  removedIds?: ReadonlySet<string>;
  onRemoveExisting?: (id: string) => void;
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Read-only (bounty fulfilment): show existing media, no add / remove. */
  locked?: boolean;
  /** Flag the section as a missing required field (red outline). */
  invalid?: boolean;
  /** Extra note rendered inside the card under the grid. */
  children?: ReactNode;
}

/**
 * The "Source media" section — its own dedicated block, shared by the submit and
 * edit forms so the source-media control reads identically everywhere. Wraps
 * `MediaManager` with the section heading.
 */
export function SourceMediaField({
  children,
  invalid = false,
  ...media
}: SourceMediaFieldProps) {
  return (
    <section
      className={`bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3${
        invalid ? ` ${FORM_INVALID_FIELD}` : ""
      }`}
    >
      <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
        Source media <FieldHelp concept="source_media" />
        {media.locked && <LockedHint />}
      </h2>
      <MediaManager {...media} />
      {children}
    </section>
  );
}
