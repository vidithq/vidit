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
 * The part of a write's payload that comes straight off the state, posted the
 * same way by all four: the source's archive paste, the mirrors and theirs, the
 * dates, the graphic-content declaration, the proof body with its inline
 * images, and the taxonomy selection. What a caller adds around it is what its
 * endpoint takes differently: the title, the coordinate, the source media, and
 * on an edit the two lossy fields that go back at the row's own precision.
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
 * The editable state behind the field block: every value the four write paths
 * post, the staged source media, the taxonomy selection, and the
 * incomplete-form feedback the fields outline themselves from. Built by
 * [`useEventForm`](#useEventForm) and handed whole to
 * [`EventFormFields`](#EventFormFields), so a caller never wires a field one
 * at a time.
 */
export interface EventFormState {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  /** The subject point. Required to publish a geolocation, an optional guess on
   *  a request. Strings: the raw input values, parsed at post time. */
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
  /** A snapshot pasted here replaces whatever copy the link carries, so it
   *  starts empty on every surface and the stored copy shows beside it: the
   *  value is what to write, not what is stored. */
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
  /** Inline proof images the editor holds locally, uploaded as `proof_files[]`
   *  at post. Covers only newly-added images: a row's existing ones are already
   *  stored URLs in the doc. */
  proofFiles: File[];
  setProofFiles: Dispatch<SetStateAction<File[]>>;
  /** Ids of stored source media marked for removal, applied at post. */
  removedIds: Set<string>;
  setRemovedIds: Dispatch<SetStateAction<Set<string>>>;
  /** Source media staged for upload. */
  newFiles: File[];
  setNewFiles: Dispatch<SetStateAction<File[]>>;
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** What the two lossy inputs were seeded with. `<input type="time">` drops
   *  the seconds and `<input type="datetime-local">` stops at the minute, so a
   *  value still equal to its seed is a field nobody touched: posting the
   *  truncation back would take the seconds off a stored record on an edit that
   *  never went near it. Both are `""` on a fresh submit, where there is no
   *  stored value to preserve. */
  seeded: { eventTime: string; sourcePostedAt: string };
  /** The payload fields every write posts identically (`EventSharedFields`). */
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
 * The seeds are `useState` initialisers, so they apply at mount: the three edit
 * surfaces mount only after their row has loaded, which is also what gives the
 * Tiptap editor its `initialContent` on first paint. The submit form mounts
 * before a request it is fulfilling has loaded, so it seeds empty and drives
 * the setters from its own load effect.
 */
export function useEventForm(row?: EventDetail | null): EventFormState {
  const seed = row ?? null;

  const [title, setTitle] = useState(seed?.title ?? "");
  // Optional on every surface but the published edit, so the string inputs
  // start empty (not `String(null)`) when the row carries no point.
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
  // Off on a fresh submit: flagging is the deliberate act, and the backend
  // column defaults to FALSE too.
  const [isGraphic, setIsGraphic] = useState(seed?.is_graphic ?? false);
  const [proof, setProof] = useState<Record<string, unknown> | null>(
    seed?.proof ?? null
  );
  const [proofFiles, setProofFiles] = useState<File[]>([]);

  // Media is staged and applied at post: a stored row can be marked for
  // removal, new files queued for upload.
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
  /** The state this block reads and writes, from `useEventForm`. */
  form: EventFormState;
  /** The stored row behind the form: the event being edited, the request being
   *  corrected, or the request being fulfilled. `null` on a fresh submit.
   *  Supplies the persisted source media and every archived copy the link
   *  fields show beside the link it covers. */
  row?: EventDetail | null;
  /** The source media comes from `row` and cannot be changed here: a request
   *  fulfilment inherits the requester's footage. */
  mediaLocked?: boolean;
  /** The source URL is inherited the same way, and shows a "from request"
   *  hint instead of an input. */
  sourceUrlLocked?: boolean;
  /** Show `row`'s provenance link, read-only. The two owner edit surfaces do;
   *  the submit form writes a record of its own and leaves it out. */
  showProvenance?: boolean;
  /** The paste line for that provenance link, wired on the one write that
   *  declares `detected_from_snapshot_url`. Without the setter the locked field
   *  renders bare. */
  detectedFromSnapshotUrl?: string;
  setDetectedFromSnapshotUrl?: (v: string) => void;
}

/**
 * The field block every event write fills in, in the one order it reads in:
 * title, source media, location, details (source link and its mirrors, their
 * archived copies, the dates, the graphic-content declaration), classification,
 * proof.
 *
 * Four write paths compose it and none keeps a copy of a field: the submit form
 * (a fresh geolocation, a request, or a fulfilment of someone else's request),
 * the owner edit of an open request, and the owner edit of a detection or a
 * published geolocation. They differ in what they post and what floor they
 * enforce, never in what the analyst fills in, so the labels, the help text and
 * the red outlines are one thing here rather than three that drift.
 *
 * What is genuinely per-surface stays with the caller: the readiness tick-list
 * and the duplicate probe on the submit form, the version note and the confirm
 * step on the published edit, and each surface's own actions.
 */
export function EventFormFields({
  form,
  row = null,
  mediaLocked = false,
  sourceUrlLocked = false,
  showProvenance = false,
  detectedFromSnapshotUrl,
  setDetectedFromSnapshotUrl,
}: EventFormFieldsProps) {
  const { invalidKeys } = form;

  return (
    <>
      {/* Title leads, mirroring the detail page where it's the heading. */}
      <TitleField
        value={form.title}
        onChange={form.setTitle}
        invalid={invalidKeys.has("title")}
      />

      {/* Source media is its own block; the subject coordinate gets the
          Location block below. */}
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
        // The age gate covers footage the analyst did not pick: a request's
        // media on a fulfilment. An owner editing their own row chose it, and
        // a staged file is the analyst's own pick either way.
        isGraphic={mediaLocked && (row?.is_graphic ?? false)}
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
        isGraphic={form.isGraphic}
        setIsGraphic={form.setIsGraphic}
        // The stored value, not the live one: the flag ratchets on the backend,
        // so a row that arrived flagged cannot be unflagged here. A fresh
        // submit leaves it false, since nothing is set yet.
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

      {/* One proof editor, images allowed: a geolocation needs an image, a
          request may attach them (work started but not finished) or stay
          imageless. The image floor binds at the geolocate. */}
      <ProofEditorPanel
        proof={form.proof}
        onChange={form.setProof}
        onProofFilesChange={form.setProofFiles}
        invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
      />
    </>
  );
}
