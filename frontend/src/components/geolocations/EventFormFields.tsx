"use client";

import {
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { EventLayoutSlots } from "@/components/event/EventLayout";

import { TitleField } from "@/components/geolocations/TitleField";
import {
  TaxonomyFields,
  useTaxonomy,
  type TaxonomyState,
} from "@/components/geolocations/TaxonomyFields";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { PROOF_GUIDE_LINK, ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { SourcesField } from "@/components/sources/SourcesField";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { cleanNumber } from "@/lib/coordinates";
import {
  missingEventFields,
  missingEventRequestFields,
  parseGuessCoords,
  type EventWriteInput,
  type MissingField,
  type MissingFieldKey,
} from "@/lib/events";
import {
  newSourceDraft,
  sourceCreatePayload,
  sourceDraftFrom,
  sourceFloor,
  type SourceDraft,
} from "@/lib/sources";
import type { EventDetail } from "@/types";

/**
 * The editable state behind the fields, built by `useEventForm` and handed whole to
 * `eventFormSlots`.
 */
export interface EventFormState {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  /** The subject point, as raw input strings parsed at post time. */
  lat: string;
  setLat: Dispatch<SetStateAction<string>>;
  lng: string;
  setLng: Dispatch<SetStateAction<string>>;
  sources: SourceDraft[];
  setSources: Dispatch<SetStateAction<SourceDraft[]>>;
  eventDate: string;
  setEventDate: Dispatch<SetStateAction<string>>;
  eventTime: string;
  setEventTime: Dispatch<SetStateAction<string>>;
  proof: string | null;
  setProof: Dispatch<SetStateAction<string | null>>;
  /** New inline proof images, uploaded as `proof_files[]` at post. */
  proofFiles: File[];
  setProofFiles: Dispatch<SetStateAction<File[]>>;
  taxonomy: TaxonomyState;
  selectedTagIds: string[];
  setSelectedTagIds: Dispatch<SetStateAction<string[]>>;
  selectedConflictIds: string[];
  setSelectedConflictIds: Dispatch<SetStateAction<string[]>>;
  /** What a geolocation publish still misses, live: the request floor, then the coordinates,
   *  the proof and the conflict. */
  publishMissing: MissingField[];
  /** What a request write still misses, live. */
  requestMissing: MissingField[];
  /** A geolocation write's body: the subject point is required, so a NaN never passes the floor
   *  that runs first. Strict parse, so a coordinate cannot read valid one way and invalid the
   *  other. */
  publishInput: (invitees?: string[]) => EventWriteInput & { geolocator_invites?: string[] };
  /** A request write's body: the subject point is an optional guess, both halves or neither. */
  requestInput: () => EventWriteInput;
  missingFields: MissingField[];
  invalidKeys: Set<MissingFieldKey>;
  validationAttempt: number;
  flagIncomplete: (fields: MissingField[]) => void;
  clearIncomplete: () => void;
}

/** The editors a row seeds: one per stored source, or one blank editor. */
function seedSources(row: EventDetail | null): SourceDraft[] {
  return row && row.sources.length > 0 ? row.sources.map(sourceDraftFrom) : [newSourceDraft()];
}

/**
 * Seed one form's state from the row it edits, or empty for a fresh submit.
 *
 * Seeds are `useState` initialisers, so they apply at mount. The edit form mounts after its row
 * loaded, which gives the proof editor its `initialContent`; the submit form seeds empty.
 */
export function useEventForm(row?: EventDetail | null): EventFormState {
  const seed = row ?? null;

  const [title, setTitle] = useState(seed?.title ?? "");
  const [lat, setLat] = useState(seed?.coords ? String(seed.coords.lat) : "");
  const [lng, setLng] = useState(seed?.coords ? String(seed.coords.lng) : "");
  const [sources, setSources] = useState<SourceDraft[]>(() => seedSources(seed));
  const [eventDate, setEventDate] = useState(seed?.occurred_date ?? "");
  // The time input drops seconds: a value equal to its seed is untouched.
  const seededEventTime = seed?.occurred_time?.slice(0, 5) ?? "";
  const [eventTime, setEventTime] = useState(seededEventTime);
  const [proof, setProof] = useState<string | null>(seed?.proof ?? null);
  const [proofFiles, setProofFiles] = useState<File[]>([]);

  const taxonomy = useTaxonomy();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    seed?.tags.map((t) => t.id) ?? []
  );
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>(
    seed?.conflicts.map((c) => c.id) ?? []
  );

  const incomplete = useIncompleteForm();

  // Memoised so the scans rerun only when an input changes.
  const floor = useMemo(() => sourceFloor(sources), [sources]);
  const requestMissing = useMemo(
    () => missingEventRequestFields({ title, sources: floor }),
    [title, floor]
  );
  const publishMissing = useMemo(
    () =>
      missingEventFields({
        title,
        lat,
        lng,
        proof,
        sources: floor,
        hasConflict: selectedConflictIds.length > 0,
      }),
    [title, lat, lng, proof, floor, selectedConflictIds]
  );

  const shared = (): Omit<EventWriteInput, "lat" | "lng"> => ({
    title: title.trim(),
    sources: sources.map(sourceCreatePayload),
    occurred_date: eventDate || undefined,
    // An untouched time goes back at the row's own precision, not as the input's truncation:
    // an absent value clears it.
    occurred_time:
      seed && eventTime === seededEventTime
        ? (seed.occurred_time ?? undefined)
        : eventTime || undefined,
    proof,
    tag_ids: selectedTagIds,
    conflict_ids: selectedConflictIds,
    proof_files: proofFiles,
  });

  return {
    title,
    setTitle,
    lat,
    setLat,
    lng,
    setLng,
    sources,
    setSources,
    eventDate,
    setEventDate,
    eventTime,
    setEventTime,
    proof,
    setProof,
    proofFiles,
    setProofFiles,
    taxonomy,
    selectedTagIds,
    setSelectedTagIds,
    selectedConflictIds,
    setSelectedConflictIds,
    publishMissing,
    requestMissing,
    publishInput: (invitees) => ({
      ...shared(),
      lat: cleanNumber(lat) ?? NaN,
      lng: cleanNumber(lng) ?? NaN,
      ...(invitees && { geolocator_invites: invitees }),
    }),
    requestInput: () => ({ ...shared(), ...parseGuessCoords(lat, lng) }),
    ...incomplete,
  };
}

/**
 * The fields every event write fills in, as `EventShell`'s zones: the Title field closes the title
 * section; in the body the sources and the proof fill the main column, and the location, then the
 * one Details card (date, time, provenance, conflict, tags), fill the side column.
 *
 * The submit form and the edit form compose it and keep no copy of a field, so labels, help and
 * red outlines stay one thing. Per-surface blocks (the version note, the geolocators) are the
 * shell's own; the writes are its pinned actions.
 */
export function eventFormSlots(
  form: EventFormState,
  {
    row = null,
    showProvenance = false,
    afterLocation,
    formId,
  }: {
    /** The stored row behind the form (the edited or published event). `null` on a fresh
     *  submit. */
    row?: EventDetail | null;
    /** Show `row`'s provenance link, read-only. */
    showProvenance?: boolean;
    /** Follows the Location section (the submit form's duplicate probe). */
    afterLocation?: ReactNode;
    /** The body `<form>`'s id, which the Title field joins from the title section. */
    formId?: string;
  } = {},
): { titleField: ReactNode; body: Omit<EventLayoutSlots, "form"> } {
  const { invalidKeys } = form;
  const proofInvalid = invalidKeys.has("proof") || invalidKeys.has("proof_image");

  return {
    titleField: (
      <TitleField
        value={form.title}
        onChange={form.setTitle}
        invalid={invalidKeys.has("title")}
        form={formId}
      />
    ),
    body: {
      sources: (
        <SourcesField
          sources={form.sources}
          setSources={form.setSources}
          tags={form.taxonomy.tags}
          setTags={form.taxonomy.setTags}
          invalidKeys={invalidKeys}
          attempt={form.validationAttempt}
        />
      ),
      // The image floor binds at the publish; a request may stay imageless.
      proof: {
        content: (
          <ProofEditorPanel
            proof={form.proof}
            onChange={form.setProof}
            proofFiles={form.proofFiles}
            onProofFilesChange={form.setProofFiles}
            invalid={proofInvalid}
          />
        ),
        invalid: proofInvalid,
        aside: PROOF_GUIDE_LINK,
      },
      details: {
        content: (
          <DetailsFields
            eventDate={form.eventDate}
            setEventDate={form.setEventDate}
            eventTime={form.eventTime}
            setEventTime={form.setEventTime}
            detectedFromUrl={showProvenance ? row?.detected_from_url : undefined}
            openedAsRequest={!!row?.requested_by}
          >
            <TaxonomyFields
              taxonomy={form.taxonomy}
              selectedTagIds={form.selectedTagIds}
              setSelectedTagIds={form.setSelectedTagIds}
              selectedConflictIds={form.selectedConflictIds}
              setSelectedConflictIds={form.setSelectedConflictIds}
              conflictInvalid={invalidKeys.has("conflict_tag")}
            />
          </DetailsFields>
        ),
        invalid: invalidKeys.has("conflict_tag"),
      },
      location: {
        content: (
          <div className="space-y-6">
            <LocationPicker
              lat={form.lat}
              setLat={form.setLat}
              lng={form.lng}
              setLng={form.setLng}
              invalid={invalidKeys.has("coordinates")}
            />
            {afterLocation}
          </div>
        ),
        invalid: invalidKeys.has("coordinates"),
      },
    },
  };
}
