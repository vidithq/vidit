"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import {
  TaxonomyFields,
  useTaxonomy,
  type TaxonomyState,
} from "@/components/geolocations/TaxonomyFields";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { archivedCopies } from "@/lib/events";
import type { MissingField, MissingFieldKey } from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import type { EventDetail } from "@/types";

/**
 * The payload fields every write posts identically, straight off the state. A
 * caller adds what its endpoint takes differently: the title, coordinate,
 * source media, and on an edit the two lossy fields.
 */
export interface EventSharedFields {
  source_snapshot_url: string;
  secondary_source_urls: string[];
  secondary_snapshot_urls: string[];
  event_date: string | undefined;
  event_time: string | undefined;
  source_posted_at: string;
  is_graphic: boolean;
  proof: Record<string, unknown> | null;
  tag_ids: string[];
  conflict_ids: string[];
  proof_files: File[];
}

/**
 * The editable state behind the field block, built by `useEventForm` and handed
 * whole to `EventFormFields`.
 */
export interface EventFormState {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  /** The subject point, as raw input strings parsed at post time. */
  lat: string;
  setLat: Dispatch<SetStateAction<string>>;
  lng: string;
  setLng: Dispatch<SetStateAction<string>>;
  /** The optional camera position, both halves or neither. */
  captureLat: string;
  setCaptureLat: Dispatch<SetStateAction<string>>;
  captureLng: string;
  setCaptureLng: Dispatch<SetStateAction<string>>;
  sourceUrl: string;
  setSourceUrl: Dispatch<SetStateAction<string>>;
  /** What to write, not what is stored: starts empty on every surface. A paste
   *  replaces the link's stored copy. */
  sourceSnapshotUrl: string;
  setSourceSnapshotUrl: Dispatch<SetStateAction<string>>;
  secondarySourceUrls: string[];
  setSecondarySourceUrls: Dispatch<SetStateAction<string[]>>;
  /** One paste per mirror, index-aligned with the list above. */
  secondarySnapshotUrls: string[];
  setSecondarySnapshotUrls: Dispatch<SetStateAction<string[]>>;
  eventDate: string;
  setEventDate: Dispatch<SetStateAction<string>>;
  eventTime: string;
  setEventTime: Dispatch<SetStateAction<string>>;
  sourcePostedAt: string;
  setSourcePostedAt: Dispatch<SetStateAction<string>>;
  isGraphic: boolean;
  setIsGraphic: Dispatch<SetStateAction<boolean>>;
  proof: Record<string, unknown> | null;
  setProof: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  /** New inline proof images, uploaded as `proof_files[]` at post. */
  proofFiles: File[];
  setProofFiles: Dispatch<SetStateAction<File[]>>;
  removedIds: Set<string>;
  setRemovedIds: Dispatch<SetStateAction<Set<string>>>;
  newFiles: File[];
  setNewFiles: Dispatch<SetStateAction<File[]>>;
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** What the two lossy inputs were seeded with (time drops seconds,
   *  datetime-local stops at the minute): a value equal to its seed is
   *  untouched, and posting the truncation would cut seconds off a stored
   *  record. Both `""` on a fresh submit. */
  seeded: { eventTime: string; sourcePostedAt: string };
  shared: () => EventSharedFields;
  missingFields: MissingField[];
  invalidKeys: Set<MissingFieldKey>;
  validationAttempt: number;
  flagIncomplete: (fields: MissingField[]) => void;
  clearIncomplete: () => void;
}

/**
 * Seed one form's state from the row it edits, or empty for a fresh submit.
 *
 * Seeds are `useState` initialisers, so they apply at mount. The edit surfaces
 * mount after their row loaded (which gives Tiptap its `initialContent`); the
 * submit form seeds empty and drives the setters from its own load effect.
 */
export function useEventForm(row?: EventDetail | null): EventFormState {
  const seed = row ?? null;

  const [title, setTitle] = useState(seed?.title ?? "");
  const [lat, setLat] = useState(
    seed?.event_coords ? String(seed.event_coords.lat) : ""
  );
  const [lng, setLng] = useState(
    seed?.event_coords ? String(seed.event_coords.lng) : ""
  );
  const [captureLat, setCaptureLat] = useState(
    seed?.capture_source_coords ? String(seed.capture_source_coords.lat) : ""
  );
  const [captureLng, setCaptureLng] = useState(
    seed?.capture_source_coords ? String(seed.capture_source_coords.lng) : ""
  );
  const [sourceUrl, setSourceUrl] = useState(seed?.source_url ?? "");
  const [sourceSnapshotUrl, setSourceSnapshotUrl] = useState("");
  const [secondarySourceUrls, setSecondarySourceUrls] = useState<string[]>(
    seed?.secondary_source_urls ?? []
  );
  const [secondarySnapshotUrls, setSecondarySnapshotUrls] = useState<string[]>(
    (seed?.secondary_source_urls ?? []).map(() => "")
  );
  const [eventDate, setEventDate] = useState(seed?.event_date ?? "");
  const seededEventTime = seed?.event_time?.slice(0, 5) ?? "";
  const seededSourcePostedAt = toDatetimeLocalUTC(seed?.source_posted_at ?? null);
  const [eventTime, setEventTime] = useState(seededEventTime);
  const [sourcePostedAt, setSourcePostedAt] = useState(seededSourcePostedAt);
  const [isGraphic, setIsGraphic] = useState(seed?.is_graphic ?? false);
  const [proof, setProof] = useState<Record<string, unknown> | null>(
    seed?.proof ?? null
  );
  const [proofFiles, setProofFiles] = useState<File[]>([]);

  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const taxonomy = useTaxonomy();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    seed?.tags.map((t) => t.id) ?? []
  );
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>(
    seed?.conflicts.map((c) => c.id) ?? []
  );

  const incomplete = useIncompleteForm();

  return {
    title,
    setTitle,
    lat,
    setLat,
    lng,
    setLng,
    captureLat,
    setCaptureLat,
    captureLng,
    setCaptureLng,
    sourceUrl,
    setSourceUrl,
    sourceSnapshotUrl,
    setSourceSnapshotUrl,
    secondarySourceUrls,
    setSecondarySourceUrls,
    secondarySnapshotUrls,
    setSecondarySnapshotUrls,
    eventDate,
    setEventDate,
    eventTime,
    setEventTime,
    sourcePostedAt,
    setSourcePostedAt,
    isGraphic,
    setIsGraphic,
    proof,
    setProof,
    proofFiles,
    setProofFiles,
    removedIds,
    setRemovedIds,
    newFiles,
    setNewFiles,
    taxonomy,
    selectedTagIds,
    setSelectedTagIds,
    selectedConflictIds,
    setSelectedConflictIds,
    seeded: { eventTime: seededEventTime, sourcePostedAt: seededSourcePostedAt },
    shared: () => ({
      source_snapshot_url: sourceSnapshotUrl,
      secondary_source_urls: secondarySourceUrls,
      secondary_snapshot_urls: secondarySnapshotUrls,
      event_date: eventDate || undefined,
      event_time: eventTime || undefined,
      source_posted_at: sourcePostedAt,
      is_graphic: isGraphic,
      proof,
      tag_ids: selectedTagIds,
      conflict_ids: selectedConflictIds,
      proof_files: proofFiles,
    }),
    ...incomplete,
  };
}

interface EventFormFieldsProps {
  form: EventFormState;
  /** The stored row behind the form (edited event, corrected or fulfilled
   *  request). `null` on a fresh submit. */
  row?: EventDetail | null;
  /** A request fulfilment inherits the requester's footage. */
  mediaLocked?: boolean;
  /** Inherited the same way; shows a "from request" hint instead of an input. */
  sourceUrlLocked?: boolean;
  /** False on the request edit, which saves without the source instant. */
  sourcePostedAtRequired?: boolean;
  /** Show `row`'s provenance link, read-only. */
  showProvenance?: boolean;
  /** Without the setter the locked field renders bare. */
  detectedFromSnapshotUrl?: string;
  setDetectedFromSnapshotUrl?: (v: string) => void;
}

/**
 * The field block every event write fills in, in reading order: title, source
 * media, location, details, classification, proof.
 *
 * The submit form, the open-request edit and the detection / published edit
 * compose it and keep no copy of a field, so labels, help and red outlines stay
 * one thing. Per-surface pieces (readiness list, duplicate probe, version note,
 * confirm step) stay with the caller.
 */
export function EventFormFields({
  form,
  row = null,
  mediaLocked = false,
  sourceUrlLocked = false,
  sourcePostedAtRequired = true,
  showProvenance = false,
  detectedFromSnapshotUrl,
  setDetectedFromSnapshotUrl,
}: EventFormFieldsProps) {
  const { invalidKeys } = form;

  return (
    <>
      <TitleField
        value={form.title}
        onChange={form.setTitle}
        invalid={invalidKeys.has("title")}
      />

      <SourceMediaField
        existing={row?.media ?? []}
        removedIds={form.removedIds}
        onRemoveExisting={
          mediaLocked
            ? undefined
            : (id) => form.setRemovedIds((prev) => new Set(prev).add(id))
        }
        staged={mediaLocked ? [] : form.newFiles}
        onAddFiles={
          mediaLocked ? undefined : (f) => form.setNewFiles((prev) => [...prev, ...f])
        }
        onRemoveStaged={
          mediaLocked
            ? undefined
            : (i) => form.setNewFiles((prev) => prev.filter((_, idx) => idx !== i))
        }
        locked={mediaLocked}
        // The age gate covers every persisted tile of a flagged row (the bot
        // opens requests, so an owner can meet unseen footage). Staged files
        // show uncovered.
        isGraphic={row?.is_graphic ?? false}
        invalid={invalidKeys.has("source_media")}
      />

      <LocationPicker
        lat={form.lat}
        setLat={form.setLat}
        lng={form.lng}
        setLng={form.setLng}
        captureLat={form.captureLat}
        setCaptureLat={form.setCaptureLat}
        captureLng={form.captureLng}
        setCaptureLng={form.setCaptureLng}
        invalid={invalidKeys.has("coordinates")}
      />

      <DetailsFields
        sourceUrl={form.sourceUrl}
        setSourceUrl={form.setSourceUrl}
        sourceSnapshotUrl={form.sourceSnapshotUrl}
        setSourceSnapshotUrl={form.setSourceSnapshotUrl}
        archivedSource={row?.archived_source ?? null}
        secondarySourceUrls={form.secondarySourceUrls}
        setSecondarySourceUrls={form.setSecondarySourceUrls}
        secondarySnapshotUrls={form.secondarySnapshotUrls}
        setSecondarySnapshotUrls={form.setSecondarySnapshotUrls}
        archivedCopies={row ? archivedCopies(row) : undefined}
        eventDate={form.eventDate}
        setEventDate={form.setEventDate}
        eventTime={form.eventTime}
        setEventTime={form.setEventTime}
        sourcePostedAt={form.sourcePostedAt}
        setSourcePostedAt={form.setSourcePostedAt}
        sourcePostedAtRequired={sourcePostedAtRequired}
        isGraphic={form.isGraphic}
        setIsGraphic={form.setIsGraphic}
        // The stored value: the flag ratchets on the backend.
        graphicLocked={row?.is_graphic ?? false}
        sourceUrlLocked={sourceUrlLocked}
        detectedFromUrl={showProvenance ? row?.detected_from_url : undefined}
        detectedFromSnapshotUrl={detectedFromSnapshotUrl}
        setDetectedFromSnapshotUrl={setDetectedFromSnapshotUrl}
        archivedDetectedFrom={row?.archived_detected_from ?? null}
        sourcePostedAtInvalid={invalidKeys.has("source_posted_at")}
        sourceUrlInvalid={invalidKeys.has("source_url")}
      />

      <TaxonomyFields
        taxonomy={form.taxonomy}
        selectedTagIds={form.selectedTagIds}
        setSelectedTagIds={form.setSelectedTagIds}
        selectedConflictIds={form.selectedConflictIds}
        setSelectedConflictIds={form.setSelectedConflictIds}
        conflictInvalid={invalidKeys.has("conflict_tag")}
        captureSourceInvalid={invalidKeys.has("capture_source_tag")}
      />

      {/* The image floor binds at the geolocate; a request may stay imageless. */}
      <ProofEditorPanel
        proof={form.proof}
        onChange={form.setProof}
        onProofFilesChange={form.setProofFiles}
        invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
      />
    </>
  );
}
