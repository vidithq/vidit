"use client";

import type { ReactNode } from "react";

import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { Media } from "@/types";

interface SourceMediaFieldProps {
  /** Persisted media (edit / request-locked). [] for a fresh submit. */
  existing?: Media[];
  removedIds?: ReadonlySet<string>;
  onRemoveExisting?: (id: string) => void;
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Read-only (a request fulfilment, which inherits the requester's media):
   *  show existing media, no add / remove. */
  locked?: boolean;
  /** What the locked marker says. Defaults to `LockedHint`'s "from request". */
  lockNote?: ReactNode;
  /** The event's `is_graphic` flag, forwarded to the persisted tiles. */
  isGraphic?: boolean;
  /** Flag the section as a missing required field (red outline). */
  invalid?: boolean;
}

/**
 * The "Source media" section — its own dedicated block, shared by the submit and
 * edit forms so the source-media control reads identically everywhere. Wraps
 * `MediaManager` with the section heading.
 */
export function SourceMediaField({
  invalid = false,
  lockNote,
  ...media
}: SourceMediaFieldProps) {
  return (
    <Card
      as="section"
      className={invalid ? FORM_INVALID_FIELD : ""}
    >
      <SectionHeading
        title="Source media"
        concept="source_media"
        trailing={media.locked ? <LockedHint>{lockNote}</LockedHint> : undefined}
        invalid={invalid}
      />
      <MediaManager {...media} />
    </Card>
  );
}
