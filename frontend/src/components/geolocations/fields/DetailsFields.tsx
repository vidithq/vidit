"use client";

import type { Dispatch, SetStateAction } from "react";

import { useNearbyConflictIds, type TaxonomyState } from "@/components/geolocations/TaxonomyFields";
import { Card } from "@/components/ui/Card";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { TagPicker } from "@/components/ui/TagPicker";
import { EVENT_FIELDS, provenanceLabel } from "@/lib/events";
import { LockedHint } from "./LockedHint";
import { LockedUrl } from "./LockedUrl";

interface DetailsFieldsProps {
  eventDate: string;
  setEventDate: (v: string) => void;
  /** "HH:MM", UTC. */
  eventTime: string;
  setEventTime: (v: string) => void;
  /** A machine detection's provenance, the post it was imported from. Shown read-only (the one
   *  immutable field). */
  detectedFromUrl?: string | null;
  /** The row carries `requested_by`: the link reads "Requested from". */
  openedAsRequest?: boolean;
  /** The two catalogue fetches (`useTaxonomy`) the conflict and tag fields pick from. */
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** Flags the conflict a publish misses (red label and outline). */
  conflictInvalid?: boolean;
  /** The subject point's inputs, whose neighbourhood suggests the conflicts. */
  lat: string;
  lng: string;
}

/** The Details card of every event form, in the order of the event page's Details card: when
 *  the event happened, the provenance link of an imported row, then the conflicts, suggested from
 *  the published events near the coordinates, and the tags, under the conflicts' retryable load
 *  error. */
export function DetailsFields({
  eventDate,
  setEventDate,
  eventTime,
  setEventTime,
  detectedFromUrl,
  openedAsRequest = false,
  taxonomy,
  selectedTagIds,
  setSelectedTagIds,
  selectedConflictIds,
  setSelectedConflictIds,
  conflictInvalid = false,
  lat,
  lng,
}: DetailsFieldsProps) {
  const nearbyConflictIds = useNearbyConflictIds(lat, lng);
  return (
    <Card dense>
      {/* One line at every width: two shrinking columns, in the side column and at 320px. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* Optional: an empty date reads as "Unknown". */}
        <div className="space-y-1.5">
          <FieldLabel {...EVENT_FIELDS.occurred_date} htmlFor="occurred_date" />
          <DateTimeInput
            id="occurred_date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel {...EVENT_FIELDS.occurred_time} htmlFor="occurred_time" />
          <DateTimeInput
            id="occurred_time"
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
          />
        </div>
      </div>

      {/* Always locked and populated, so always the link form. */}
      {detectedFromUrl && (
        <div className="space-y-1.5">
          <FieldLabel
            {...EVENT_FIELDS.detected_from}
            label={provenanceLabel(openedAsRequest)}
            trailing={<LockedHint>provenance, can&apos;t change</LockedHint>}
          />
          <LockedUrl href={detectedFromUrl} />
        </div>
      )}
      {taxonomy.conflictsError && (
        <ErrorNotice
          error={{ ...taxonomy.conflictsError, title: "Couldn't load the Conflict options" }}
          onRetry={taxonomy.reloadConflicts}
        />
      )}
      <TagPicker
        tags={taxonomy.tags}
        setTags={taxonomy.setTags}
        suggestedTags={taxonomy.suggestedTags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        conflicts={taxonomy.conflicts}
        selectedConflictIds={selectedConflictIds}
        setSelectedConflictIds={setSelectedConflictIds}
        suggestedConflictIds={nearbyConflictIds}
        conflictInvalid={conflictInvalid}
      />
    </Card>
  );
}
