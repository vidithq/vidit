"use client";

import {
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { EventLayoutSlots } from "@/components/event/EventLayout";
import { EventShell } from "@/components/event/EventShell";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";

import { TitleField } from "@/components/geolocations/TitleField";
import { useTaxonomy, type TaxonomyState } from "@/components/geolocations/TaxonomyFields";
import { DetailsFields } from "@/components/geolocations/fields/DetailsFields";
import { LocationPicker } from "@/components/geolocations/fields/LocationPicker";
import { PROOF_GUIDE_LINK, ProofEditorPanel } from "@/components/geolocations/fields/ProofEditorPanel";
import { LinkedSitesField, useSiteLinksDraft, type SiteLinksDraft } from "@/components/sites/LinkedSitesField";
import type { DraftSiteLink } from "@/lib/sites";
import { SourcesField } from "@/components/sources/SourcesField";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { cleanNumber } from "@/lib/coordinates";
import { hhmm } from "@/lib/format";
import { storedProofImages } from "@/lib/proof";
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
  restoredSourceDraft,
  sourceCreatePayload,
  sourceDraftFrom,
  sourceFloor,
  type SourceDraft,
} from "@/lib/sources";
import type { EventDetail } from "@/types";

/** The fields of an event form as one storable value. */
export interface EventFormDraft {
  title: string;
  /** The subject point, as raw input strings parsed at post time. */
  lat: string;
  lng: string;
  sources: SourceDraft[];
  eventDate: string;
  eventTime: string;
  proof: string | null;
  /** New inline proof images, uploaded as `proof_files[]` at post. */
  proofFiles: File[];
  tagIds: string[];
  conflictIds: string[];
  siteLinks: DraftSiteLink[];
}

/** The fields `useEventForm` holds itself; the Linked sites live in their own draft. */
type EventFormFields = Omit<EventFormDraft, "siteLinks">;

type FieldSetter = <K extends keyof EventFormFields>(
  key: K,
) => Dispatch<SetStateAction<EventFormFields[K]>>;

/**
 * The editable state behind the fields, built by `useEventForm` and handed whole to
 * `eventFormSlots`.
 */
export interface EventFormState {
  fields: EventFormFields;
  /** The setter of one field. Each key returns the same function on every render. */
  set: FieldSetter;
  taxonomy: TaxonomyState;
  /** The Linked sites, written after a geolocation write. */
  siteLinks: SiteLinksDraft;
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
  /** Every field as it stands, memoised on them: what the submit form stores across a reload. */
  draft: EventFormDraft;
  /** Puts a stored `draft` back into every field. */
  restoreDraft: (draft: EventFormDraft) => void;
}

// The time input drops seconds: a value equal to its seed is untouched.
const seedEventTime = (row: EventDetail | null): string =>
  row?.occurred_time ? hhmm(row.occurred_time) : "";

/** The fields a row seeds: one source editor per stored source, or one blank editor. */
function seedFields(row: EventDetail | null): EventFormFields {
  return {
    title: row?.title ?? "",
    lat: row?.coords ? String(row.coords.lat) : "",
    lng: row?.coords ? String(row.coords.lng) : "",
    sources: row && row.sources.length > 0 ? row.sources.map(sourceDraftFrom) : [newSourceDraft()],
    eventDate: row?.occurred_date ?? "",
    eventTime: seedEventTime(row),
    proof: row?.proof ?? null,
    proofFiles: [],
    tagIds: row?.tags.map((t) => t.id) ?? [],
    conflictIds: row?.conflicts.map((c) => c.id) ?? [],
  };
}

/**
 * Seed one form's state from the row it edits, or empty for a fresh submit.
 *
 * Seeds are `useState` initialisers, so they apply at mount. The edit form mounts after its row
 * loaded, which gives the proof editor its `initialContent`; the submit form seeds empty.
 */
export function useEventForm(row?: EventDetail | null): EventFormState {
  const seed = row ?? null;

  const [fields, setFields] = useState<EventFormFields>(() => seedFields(seed));
  const seededEventTime = seedEventTime(seed);
  // Stable per key, as `useState` setters are: a child effect that depends on one must not rerun.
  const [set] = useState<FieldSetter>(() => {
    const setters = new Map<keyof EventFormFields, unknown>();
    return <K extends keyof EventFormFields>(key: K) => {
      if (!setters.has(key)) {
        const setter: Dispatch<SetStateAction<EventFormFields[K]>> = (value) =>
          setFields((prev) => {
            const next =
              typeof value === "function"
                ? (value as (current: EventFormFields[K]) => EventFormFields[K])(prev[key])
                : value;
            return Object.is(next, prev[key]) ? prev : { ...prev, [key]: next };
          });
        setters.set(key, setter);
      }
      return setters.get(key) as Dispatch<SetStateAction<EventFormFields[K]>>;
    };
  });
  const { title, lat, lng, sources, eventTime, proof, conflictIds } = fields;

  const taxonomy = useTaxonomy();
  const siteLinks = useSiteLinksDraft(seed);
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
        hasConflict: conflictIds.length > 0,
        siteEffectMissing: siteLinks.missingEffect,
      }),
    [title, lat, lng, proof, floor, conflictIds, siteLinks.missingEffect]
  );

  const draft = useMemo<EventFormDraft>(
    () => ({ ...fields, siteLinks: siteLinks.links }),
    [fields, siteLinks.links]
  );
  const restoreDraft = ({ siteLinks: links, ...stored }: EventFormDraft) => {
    const now = Date.now();
    setFields({
      ...stored,
      sources: stored.sources.map((source) => restoredSourceDraft(source, now)),
    });
    siteLinks.setLinks(links);
  };

  const shared = (): Omit<EventWriteInput, "lat" | "lng"> => ({
    title: title.trim(),
    sources: sources.map(sourceCreatePayload),
    occurred_date: fields.eventDate || undefined,
    // An untouched time goes back at the row's own precision, not as the input's truncation:
    // an absent value clears it.
    occurred_time:
      seed && eventTime === seededEventTime
        ? (seed.occurred_time ?? undefined)
        : eventTime || undefined,
    proof,
    tag_ids: fields.tagIds,
    conflict_ids: conflictIds,
    proof_files: fields.proofFiles,
  });

  return {
    fields,
    set,
    taxonomy,
    siteLinks,
    publishMissing,
    requestMissing,
    publishInput: (invitees) => ({
      ...shared(),
      lat: cleanNumber(lat) ?? NaN,
      lng: cleanNumber(lng) ?? NaN,
      ...(invitees && { geolocator_invites: invitees }),
    }),
    requestInput: () => ({ ...shared(), ...parseGuessCoords(lat, lng) }),
    missingFields: incomplete.missingFields,
    invalidKeys: incomplete.invalidKeys,
    validationAttempt: incomplete.validationAttempt,
    flagIncomplete: incomplete.flagIncomplete,
    clearIncomplete: incomplete.clearIncomplete,
    draft,
    restoreDraft,
  };
}

/** Where the fields come from and what follows them, past the form state. */
interface EventFormFieldsOptions {
  /** The stored row behind the form (the edited or published event). `null` on a fresh
   *  submit. */
  row?: EventDetail | null;
  /** Follows the Location block (the submit form's duplicate probe). */
  afterLocation?: ReactNode;
  /** Shows the Linked sites field. An open request's form leaves it out: only a published
   *  event links to a site. */
  siteLinks?: boolean;
}

/**
 * An event form on `EventShell`, as both event forms render it: the fields of `eventFormSlots`
 * in the shell's zones, the writes pinned with the hidden `IncompleteFormAnnouncer` under them,
 * and the body's `<form>`. The form is `noValidate`, since the red outlines and the announcer
 * own the required-field feedback; a submit (Enter in a field, a submit button outside the form
 * that joins it through `formId`) runs `onSubmit`, or nothing when the writes are explicit
 * buttons.
 */
export function EventFormShell({
  form,
  title,
  byline,
  backFallback,
  onBack,
  actions,
  formId,
  onSubmit,
  fields,
}: {
  form: EventFormState;
  /** The page name: a visually hidden `h1` and the browser tab's title. */
  title: string;
  byline: ReactNode;
  backFallback?: string;
  onBack?: () => void;
  /** The writes, pinned top right. */
  actions: ReactNode;
  /** The `<form>`'s id, which the Title field and a submit button join from outside it. */
  formId?: string;
  onSubmit?: () => void;
  fields?: EventFormFieldsOptions;
}) {
  const { titleField, body } = eventFormSlots(form, { ...fields, formId });
  return (
    <EventShell
      title={title}
      titleField={titleField}
      byline={byline}
      backFallback={backFallback}
      onBack={onBack}
      actions={{
        pinned: actions,
        below: (
          <IncompleteFormAnnouncer
            attempt={form.validationAttempt}
            missing={form.missingFields.map((m) => m.label)}
          />
        ),
      }}
      body={{
        ...body,
        form: {
          id: formId,
          onSubmit: (e) => {
            e.preventDefault();
            onSubmit?.();
          },
          noValidate: true,
        },
      }}
    />
  );
}

/**
 * The fields every event write fills in, as `EventShell`'s slots. The submit form and the edit
 * form compose it and keep no copy of a field, so labels, help and red outlines stay one thing.
 */
function eventFormSlots(
  form: EventFormState,
  {
    row = null,
    afterLocation,
    siteLinks = true,
    formId,
  }: EventFormFieldsOptions & {
    /** The body `<form>`'s id, which the Title field joins from the title section. */
    formId?: string;
  },
): { titleField: ReactNode; body: Omit<EventLayoutSlots, "form"> } {
  const { invalidKeys } = form;
  const proofInvalid = invalidKeys.has("proof") || invalidKeys.has("proof_image");

  return {
    titleField: (
      <TitleField
        value={form.fields.title}
        onChange={form.set("title")}
        invalid={invalidKeys.has("title")}
        form={formId}
      />
    ),
    body: {
      sources: (
        <SourcesField
          sources={form.fields.sources}
          setSources={form.set("sources")}
          tags={form.taxonomy.tags}
          setTags={form.taxonomy.setTags}
          suggestedTags={form.taxonomy.suggestedTags}
          invalidKeys={invalidKeys}
          attempt={form.validationAttempt}
          proofImages={
            row ? { eventId: row.id, urls: storedProofImages(form.fields.proof, row.proof) } : undefined
          }
        />
      ),
      // The image floor binds at the publish; a request may stay imageless.
      proof: {
        content: (
          <ProofEditorPanel
            proof={form.fields.proof}
            onChange={form.set("proof")}
            proofFiles={form.fields.proofFiles}
            onProofFilesChange={form.set("proofFiles")}
            invalid={proofInvalid}
          />
        ),
        invalid: proofInvalid,
        aside: PROOF_GUIDE_LINK,
      },
      details: {
        content: (
          <DetailsFields
            eventDate={form.fields.eventDate}
            setEventDate={form.set("eventDate")}
            eventTime={form.fields.eventTime}
            setEventTime={form.set("eventTime")}
            detectedFromUrl={row?.detected_from_url}
            openedAsRequest={!!row?.requested_by}
            taxonomy={form.taxonomy}
            selectedTagIds={form.fields.tagIds}
            setSelectedTagIds={form.set("tagIds")}
            selectedConflictIds={form.fields.conflictIds}
            setSelectedConflictIds={form.set("conflictIds")}
            conflictInvalid={invalidKeys.has("conflict_tag")}
          />
        ),
        invalid: invalidKeys.has("conflict_tag"),
      },
      location: {
        content: (
          <div className="space-y-6">
            <LocationPicker
              lat={form.fields.lat}
              setLat={form.set("lat")}
              lng={form.fields.lng}
              setLng={form.set("lng")}
              invalid={invalidKeys.has("coordinates")}
            />
            {afterLocation}
          </div>
        ),
        invalid: invalidKeys.has("coordinates"),
      },
      sites: siteLinks && (
        <LinkedSitesField
          draft={form.siteLinks}
          lat={form.fields.lat}
          lng={form.fields.lng}
          invalid={invalidKeys.has("site_effect")}
        />
      ),
    },
  };
}
