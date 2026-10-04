"use client";

import { MediaManager } from "@/components/geolocations/MediaManager";
import { LockedHint } from "@/components/geolocations/new/LockedHint";
import { FORM_INVALID_FIELD } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { Media } from "@/types";

interface SourceMediaFieldProps {
  existing?: Media[];
  removedIds?: ReadonlySet<string>;
  onRemoveExisting?: (id: string) => void;
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Read-only (a request fulfilment inherits the requester's media). */
  locked?: boolean;
  isGraphic?: boolean;
  invalid?: boolean;
}

/** The "Source media" section, shared by the submit and edit forms: `MediaManager`
 *  under the section heading. */
export function SourceMediaField({ invalid = false, ...media }: SourceMediaFieldProps) {
  return (
    <Card
      as="section"
      className={invalid ? FORM_INVALID_FIELD : ""}
    >
      <SectionHeading
        title="Source media"
        concept="source_media"
        trailing={media.locked ? <LockedHint /> : undefined}
        invalid={invalid}
      />
      <MediaManager {...media} />
    </Card>
  );
}
