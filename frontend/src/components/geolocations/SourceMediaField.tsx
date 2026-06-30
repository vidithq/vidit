"use client";

import type { ReactNode } from "react";

import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
    <Card
      as="section"
      spacing="3"
      className={invalid ? FORM_INVALID_FIELD : ""}
    >
      <SectionHeading
        title="Source media"
        concept="source_media"
        trailing={media.locked ? <LockedHint /> : undefined}
      />
      <MediaManager {...media} />
      {children}
    </Card>
  );
}
