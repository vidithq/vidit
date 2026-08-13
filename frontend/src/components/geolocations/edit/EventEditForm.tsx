"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { DownloadSourceMedia } from "@/components/geolocations/DownloadSourceMedia";
import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Button, buttonClasses } from "@/components/ui/Button";
import {
  TaxonomyFields,
  useTaxonomy,
} from "@/components/geolocations/TaxonomyFields";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import { useEventActions } from "@/components/event/useEventActions";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { cleanNumber } from "@/lib/coordinates";
import {
  geolocateEvent,
  missingEventFields,
  parseCaptureCoords,
  type EventFieldsState,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import type { EventDetail } from "@/types";

/**
 * Owner edit + submit of a machine-`detected` geolocation. Built like the create
 * form (same field bricks, same `MediaManager` staging): the owner curates the
 * whole detection (title, coordinate, source URL, dates, proof including inline
 * images, tags, and source media, with new files staged and existing ones marked
 * for removal). Only `detected_from_url` (provenance) is immutable. A `detected`
 * row is immutable machine output; **Submit** is the only write, applying the
 * whole form and flipping the row to `geolocated` in one atomic multipart request
 * (with a confirm, since submitting freezes it). State is seeded from props (the
 * form mounts only after the row loaded), so the Tiptap editor gets its
 * `initialContent` on first paint.
 */
export function EventEditForm({
  geo,
  redirectTo,
}: {
  geo: EventDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  // The utilities tier only: this page's flow action is the form's own
  // "Confirm & submit", which stays at the bottom where the fields it applies
  // end. The header still shares and reports the draft like every other detail
  // surface.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  const [title, setTitle] = useState(geo.title);
  // Coordinates + event date are optional on a ``detected`` draft, so seed the
  // string inputs from empty (not ``String(null)``) when the row lacks them.
  const [lat, setLat] = useState(
    geo.event_coords ? String(geo.event_coords.lat) : ""
  );
  const [lng, setLng] = useState(
    geo.event_coords ? String(geo.event_coords.lng) : ""
  );
  // The optional camera position, seeded from the row (a detection may already
  // carry one) and editable here. Both-or-neither at submit.
  const [captureLat, setCaptureLat] = useState(
    geo.capture_source_coords ? String(geo.capture_source_coords.lat) : ""
  );
  const [captureLng, setCaptureLng] = useState(
    geo.capture_source_coords ? String(geo.capture_source_coords.lng) : ""
  );
  // A ``detected`` draft may be born with no declared source, so the field
  // starts empty (not `String(null)`) rather than showing a fabricated value.
  const [sourceUrl, setSourceUrl] = useState(geo.source_url ?? "");
  // The mirrors the import found, editable here: submitting replaces the whole
  // list, so a row the owner deletes is gone from the published event.
  const [secondarySourceUrls, setSecondarySourceUrls] = useState<string[]>(
    geo.secondary_source_urls
  );
  const [eventDate, setEventDate] = useState(geo.event_date ?? "");
  const [eventTime, setEventTime] = useState(geo.event_time?.slice(0, 5) ?? "");
  const [sourcePostedAt, setSourcePostedAt] = useState(
    toDatetimeLocalUTC(geo.source_posted_at)
  );
  // The graphic-content declaration the draft already carries, editable here.
  // Submitting posts the whole state, so an untouched switch re-posts the same
  // value rather than clearing it.
  const [isGraphic, setIsGraphic] = useState(geo.is_graphic);
  const [proof, setProof] = useState<Record<string, unknown> | null>(geo.proof);
  // Inline proof images the editor holds locally; uploaded as `proof_files[]`
  // at submit. A detection's existing proof images are already stored URLs in
  // the doc, so this set covers only newly-added images.
  const [proofFiles, setProofFiles] = useState<File[]>([]);

  // Media is staged (applied on save), like submit: existing rows can be marked
  // for removal, new files queued for upload.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);

  // Curated selectors + free tags, owned by the shared taxonomy block (same
  // lists and failure banners as the create form).
  const taxonomy = useTaxonomy();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    geo.tags.map((t) => t.id)
  );
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>(
    geo.conflicts.map((c) => c.id)
  );

  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  // Incomplete-form feedback (shared notice + in-form red outlines).
  const {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
  } = useIncompleteForm();

  const buildInput = () => ({
    title: title.trim(),
    // Same strict parse as the two optional coordinate pairs, so one coordinate
    // can't read valid one way and invalid the other. Required here (the floor
    // check below runs first), so a NaN never reaches a submit.
    lat: cleanNumber(lat) ?? NaN,
    lng: cleanNumber(lng) ?? NaN,
    ...parseCaptureCoords(captureLat, captureLng),
    source_url: sourceUrl.trim(),
    secondary_source_urls: secondarySourceUrls,
    event_date: eventDate || undefined,
    event_time: eventTime || undefined,
    source_posted_at: sourcePostedAt,
    is_graphic: isGraphic,
    proof,
    tag_ids: selectedTagIds,
    conflict_ids: selectedConflictIds,
    remove_media_ids: [...removedIds],
    files: newFiles,
    proof_files: proofFiles,
  });

  // Submit is the only write to a detection: it applies the whole form and flips
  // the row to `geolocated` in one atomic request (the server enforces the floor
  // too). A `detected` row is otherwise immutable machine output.
  const submitMutation = useMutation(() => geolocateEvent(geo.id, buildInput()), {
    fallback: "Couldn't submit.",
    onSuccess: () => {
      refreshDetectionCount();
      router.push(redirectTo);
    },
  });

  // Reject (close) the detection: a detection card is just a click, like every
  // other card. The reason is captured in an inline `CloseEventForm` (required
  // + publicly visible), which owns its own close mutation; this flag just
  // toggles the panel.
  const [rejecting, setRejecting] = useState(false);

  const busy = submitMutation.loading;
  const actionError = submitMutation.error;

  // Submit floor is computed on the post-edit state: kept existing media plus
  // staged new files, and the selected curated tags.
  const keptMediaCount =
    geo.media.filter((m) => !removedIds.has(m.id)).length + newFiles.length;
  const selectedCurated = taxonomy.curatedTags.filter((t) =>
    selectedTagIds.includes(t.id)
  );

  const fieldsState = (): EventFieldsState => ({
    title,
    lat,
    lng,
    sourceUrl,
    sourcePostedAt,
    proof,
    mediaCount: keptMediaCount,
    hasConflictTag: selectedConflictIds.length > 0,
    hasCaptureSourceTag: selectedCurated.some(
      (t) => t.category === "capture_source"
    ),
  });

  // Submit enforces the full floor (it freezes the row), then asks to confirm.
  // Submitting an incomplete detection surfaces the notice (every miss at once)
  // instead of entering the confirm step.
  const attemptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.reset();
    clearIncomplete();
    // The Conflict / Capture-source taxonomy must be loaded before the floor can
    // tell "didn't pick one" from "options still loading", otherwise it would
    // spuriously report both tags missing. Recoverable state, not a missing
    // field, and the same message the create form shows.
    if (taxonomy.blockedMessage !== null) {
      submitMutation.setError(taxonomy.blockedMessage);
      return;
    }
    const missing = missingEventFields(fieldsState(), {
      requireMedia: true,
      requireTags: true,
    });
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    setConfirmingSubmit(true);
  };

  const handleSubmit = () => {
    submitMutation.run();
  };

  return (
    <PageShell
      back
      title="Submit detection"
      subtitle="Review and complete this machine detection, then submit it. Submitting freezes the row, so give it a full read first."
      actions={actions}
    >
      {/* Under the header, where the trigger that opened it is. */}
      {panels}

      {/* `noValidate`: the shared IncompleteFormNotice owns required-field
          feedback, so the browser's native validation must not preempt it. */}
      <form onSubmit={attemptSubmit} className="space-y-6" noValidate>
        <TitleField
          value={title}
          onChange={setTitle}
          invalid={invalidKeys.has("title")}
        />

        <SourceMediaField
          existing={geo.media}
          removedIds={removedIds}
          onRemoveExisting={(id) => setRemovedIds((prev) => new Set(prev).add(id))}
          staged={newFiles}
          onAddFiles={(f) => setNewFiles((prev) => [...prev, ...f])}
          onRemoveStaged={(i) =>
            setNewFiles((prev) => prev.filter((_, idx) => idx !== i))
          }
          invalid={invalidKeys.has("source_media")}
        >
          {/* Offered only while the slot is empty: one source media per event,
              so with one kept or staged there is nothing to download into. */}
          {keptMediaCount === 0 && (
            <DownloadSourceMedia
              sourceUrl={sourceUrl}
              onFile={(file) => setNewFiles([file])}
            />
          )}
        </SourceMediaField>

        <LocationPicker
          lat={lat}
          setLat={setLat}
          lng={lng}
          setLng={setLng}
          captureLat={captureLat}
          setCaptureLat={setCaptureLat}
          captureLng={captureLng}
          setCaptureLng={setCaptureLng}
          extraCoordCandidates={[]}
          onSwapCandidate={() => {}}
          invalid={invalidKeys.has("coordinates")}
        />

        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          secondarySourceUrls={secondarySourceUrls}
          setSecondarySourceUrls={setSecondarySourceUrls}
          eventDate={eventDate}
          setEventDate={setEventDate}
          eventTime={eventTime}
          setEventTime={setEventTime}
          sourcePostedAt={sourcePostedAt}
          setSourcePostedAt={setSourcePostedAt}
          isGraphic={isGraphic}
          setIsGraphic={setIsGraphic}
          // The loaded value, not the live one: the flag ratchets on the
          // backend, so an event that arrived flagged cannot be unflagged here.
          graphicLocked={geo.is_graphic}
          sourceUrlLocked={false}
          detectedFromUrl={geo.detected_from_url}
          sourcePostedAtInvalid={invalidKeys.has("source_posted_at")}
          sourceUrlInvalid={invalidKeys.has("source_url")}
        />

        <TaxonomyFields
          taxonomy={taxonomy}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
          selectedConflictIds={selectedConflictIds}
          setSelectedConflictIds={setSelectedConflictIds}
          conflictInvalid={invalidKeys.has("conflict_tag")}
          captureSourceInvalid={invalidKeys.has("capture_source_tag")}
        />

        <ProofEditorPanel
          importedFrom={null}
          importGen={0}
          proof={proof}
          onChange={setProof}
          onProofFilesChange={setProofFiles}
          invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
        />

        {/* Validation + errors sit right above the actions: the notice lists
            every missing field at once, the banner carries server failures. */}
        <IncompleteFormNotice
          key={validationAttempt}
          missing={missingFields.map((m) => m.label)}
        />
        {actionError && <div className={FORM_ERROR_BANNER}>{actionError}</div>}

        <div className="flex flex-wrap items-center gap-3">
          {confirmingSubmit ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-amber-400/90">
                Once submitted it can&apos;t be edited.
              </span>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={busy}
              >
                {submitMutation.loading ? "Submitting…" : "Confirm & submit"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmingSubmit(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Button
                type="submit"
                variant="primary"
                disabled={busy}
              >
                Submit
              </Button>
              <FieldHelp concept="action_submit" />
            </span>
          )}

          <Link href={redirectTo} className={buttonClasses("ghost")}>
            Cancel
          </Link>

          {/* Reject (close) lives here now, not on the queue card. It opens the
              inline reason panel below rather than closing on a fixed reason. */}
          {!rejecting && (
            <Button
              variant="danger"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="ml-auto"
            >
              Reject detection
            </Button>
          )}
        </div>

        {/* The reason panel for rejecting the detection: a required free-text
            reason (kept publicly visible on the closed row). On success it
            refreshes the detection count and returns to the queue. */}
        {rejecting && (
          <div className="pt-4 border-t border-neutral-800">
            <CloseEventForm
              eventId={geo.id}
              status={geo.status}
              disabled={busy}
              onClosed={() => {
                refreshDetectionCount();
                router.push(redirectTo);
              }}
              onCancel={() => setRejecting(false)}
            />
          </div>
        )}
      </form>
    </PageShell>
  );
}
