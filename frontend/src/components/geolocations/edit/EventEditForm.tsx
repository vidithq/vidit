"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import { ARMED_RING } from "@/components/ui/styles";
import { FORM_ERROR_BANNER, LABEL_TEXT } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Button } from "@/components/ui/Button";
import {
  TaxonomyFields,
  useTaxonomy,
} from "@/components/geolocations/TaxonomyFields";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import { useEventActions } from "@/components/event/useEventActions";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
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

// Ties Reject to the reason panel it opens, which is not its DOM sibling.
const REJECT_PANEL_ID = "reject-detection-form";

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
 *
 * Reviewing a queue of drafts is this same surface with `queue` set: the header
 * gains the position and a Skip, and a finished draft hands over to the next one
 * instead of returning to the queue list. Nothing else differs, so a draft opened
 * from a queue row and a draft under review are one form.
 */
export function EventEditForm({
  geo,
  redirectTo,
  queue,
}: {
  geo: EventDetail;
  redirectTo: string;
  /** Set when this draft is one step of a review pass over the queue. */
  queue?: {
    /** Where this draft sits in the queue, as `Draft n of m`. */
    position: string;
    /** Open the next draft, or leave for `redirectTo` past the last one. Runs
     *  on Skip, and after a submit or a rejection. */
    onAdvance: () => void;
  };
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  // Where a write that finishes with this row goes: back to the queue list on
  // its own, on to the next draft during a review pass.
  const finish = queue?.onAdvance ?? (() => router.push(redirectTo));

  // The utilities tier only: this surface's flow action is the form's own
  // Submit, at the bottom where the fields it applies end. The header still
  // shares and reports the draft like every other detail surface.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  // Reject the draft: the confirm step is the inline `CloseEventForm` (a
  // required, publicly visible reason), so this flag only opens the panel. It
  // sits in the open beside Skip rather than behind the `⋯` menu: the menu is
  // for the rare management action on a reading surface, while working a draft
  // has three verbs (submit it, skip it, reject it) and hiding one of them
  // behind a disclosure costs a click on every pass.
  const [rejecting, setRejecting] = useState(false);

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
  // A snapshot pasted here replaces whatever copy the draft carries, so the
  // field starts empty and the existing copy shows beside it instead: the value
  // is what to write, not what is stored.
  const [sourceSnapshotUrl, setSourceSnapshotUrl] = useState("");
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
    source_snapshot_url: sourceSnapshotUrl,
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
      finish();
    },
  });

  // Submitting freezes the row, so it takes a second click. The button arms in
  // place rather than swapping itself for a confirm pair: the control the
  // reader is aiming at stays where it is, and the second click lands on the
  // same pixels as the first. It keeps focus, so Enter twice submits too.
  const {
    armed: submitArmed,
    trigger: triggerSubmit,
    controlRef: submitButtonRef,
  } = useConfirmAction(
    () => {
      void submitMutation.run();
    },
    {
      timeoutMs: ARM_MS,
      dismissOnOutside: true,
    }
  );

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
    // A snapshot that cannot be one is caught before the upload; the field
    // flags itself red and the banner says what a snapshot link looks like.
    if (sourceSnapshotUrl.trim() && !isSnapshotUrl(sourceSnapshotUrl)) {
      submitMutation.setError(SNAPSHOT_HINT);
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
    // A complete form arms the button; the click after it writes. Every check
    // above runs on both clicks, so a form that stopped being submittable
    // between them says so instead of posting.
    triggerSubmit();
  };

  return (
    <PageShell
      back
      backFallback={redirectTo}
      title="Submit detection"
      actions={
        // Everything that disposes of this draft rather than filling it in,
        // in the header's own cluster: the position and the way past it during
        // a review pass, then Reject, then the utilities. Submit is the only
        // action left at the foot of the fields.
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          {queue && (
            <>
              <span className={LABEL_TEXT}>{queue.position}</span>
              <Button variant="secondary" onClick={queue.onAdvance} disabled={busy}>
                Skip
              </Button>
            </>
          )}
          <Button
            variant="danger"
            onClick={() => setRejecting(true)}
            disabled={busy || rejecting}
            aria-controls={REJECT_PANEL_ID}
            aria-expanded={rejecting}
          >
            Reject
          </Button>
          {actions}
        </div>
      }
    >
      {/* Under the header, where the trigger that opened it is. */}
      {panels}

      {/* The reason panel Reject opens, in the same slot the shared action
          row's own panels use: under the header, below its trigger. */}
      {rejecting && (
        <div id={REJECT_PANEL_ID}>
          <Card as="section">
            <SectionEyebrow title="Reject this detection" margin="none" />
            <CloseEventForm
              eventId={geo.id}
              status={geo.status}
              disabled={busy}
              onClosed={() => {
                refreshDetectionCount();
                finish();
              }}
              onCancel={() => setRejecting(false)}
            />
          </Card>
        </div>
      )}

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
        />

        <LocationPicker
          lat={lat}
          setLat={setLat}
          lng={lng}
          setLng={setLng}
          captureLat={captureLat}
          setCaptureLat={setCaptureLat}
          captureLng={captureLng}
          setCaptureLng={setCaptureLng}
          invalid={invalidKeys.has("coordinates")}
        />

        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          sourceSnapshotUrl={sourceSnapshotUrl}
          setSourceSnapshotUrl={setSourceSnapshotUrl}
          archivedSource={geo.archived_source}
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

        {/* The flow action, alone at the foot of the fields it applies, as on
            the create form. Disposing of the draft is not a form action: Skip
            and Reject sit in the header. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Button
              ref={submitButtonRef}
              type="submit"
              variant="primary"
              disabled={busy}
              className={submitArmed ? ARMED_RING : ""}
              title={
                submitArmed
                  ? "Click again to submit. Submitting freezes the event."
                  : undefined
              }
            >
              {/* The three labels stack in one grid cell, so the button is as
                  wide as the longest of them from the first paint and arming
                  moves nothing at all, not even the `?` beside it. */}
              <span className="grid">
                <span aria-hidden className="col-start-1 row-start-1 invisible">
                  Confirm submit
                </span>
                <span className="col-start-1 row-start-1">
                  {busy
                    ? "Submitting…"
                    : submitArmed
                      ? "Confirm submit"
                      : "Submit"}
                </span>
              </span>
            </Button>
            {/* What the second click costs is the button's `?`, which every
                field on this form already carries, rather than a line of copy
                that appears mid-gesture and pushes the button sideways. */}
            <FieldHelp concept="action_submit" />
          </span>
          {/* Sibling status region, the shape `<CopyButton>` uses: the armed
              state is reported once, as a status, so a reader who cannot see
              the ring hears what the next click will do. */}
          <span className="sr-only" role="status" aria-live="polite">
            {submitArmed
              ? "Click again to submit. Submitting freezes the event."
              : ""}
          </span>
        </div>
      </form>
    </PageShell>
  );
}
