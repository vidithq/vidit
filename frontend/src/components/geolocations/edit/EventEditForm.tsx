"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";

import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
import { closeActionLabel, CloseEventForm } from "@/components/event/CloseEventForm";
import { useEventActions } from "@/components/event/useEventActions";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { Input } from "@/components/ui/Input";
import { cleanNumber } from "@/lib/coordinates";
import {
  archivedCopies,
  VERSION_NOTE_MAX_LEN,
  geolocateEvent,
  hasVersionChanges,
  missingEventFields,
  nothingChangedMessage,
  parseCaptureCoords,
  saveVersion,
  type EventFieldsState,
  type EventVersionFormState,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import type { EventDetail } from "@/types";

// Ties Close to the reason panel it opens, which is not its DOM sibling.
const CLOSE_PANEL_ID = "close-detection-form";

/**
 * Owner edit of one event, in the two shapes an owner edits in.
 *
 * **Submit** (a machine-`detected` row): the owner curates the whole detection
 * (title, coordinate, source URL, dates, proof including inline images, tags,
 * and source media, with new files staged and existing ones marked for removal)
 * and submits it, which applies the form and flips the row to `geolocated` in
 * one atomic multipart request. Only `detected_from_url` (provenance) is
 * immutable, and the write takes a confirm, since publishing makes the event
 * public.
 *
 * **Save version** (a `geolocated` row): the same fields, the evidence anchor
 * included. `source_url` and the source media are editable here as on a
 * detection, and the write files the version it supersedes rather than
 * overwriting it, so the record keeps what the claim rested on. An optional
 * note travels with that version. No confirm: a version adds a version, which
 * is the ordinary way a published event changes.
 *
 * Built like the create form throughout (same field bricks, same `MediaManager`
 * staging). State is seeded from props (the form mounts only after the row
 * loaded), so the Tiptap editor gets its `initialContent` on first paint.
 *
 * Reviewing a queue of detections is this same surface with `queue` set: the header
 * gains the position and a Skip, and a finished detection hands over to the next one
 * instead of returning to the queue list. Nothing else differs, so a detection opened
 * from a queue row and a detection under review are one form.
 */
export function EventEditForm({
  geo,
  redirectTo,
  queue,
}: {
  geo: EventDetail;
  redirectTo: string;
  /** Set when this detection is one step of a review pass over the queue. */
  queue?: {
    /** Where this detection sits in the queue, as `Detection n of m`. */
    position: string;
    /** Open the next detection, or leave for `redirectTo` past the last one. Runs
     *  on Skip, and after a submit or a rejection. */
    onAdvance: () => void;
  };
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  // Which of the two edits this is. Read off the row rather than passed in:
  // the state IS the mode, so the page and the form cannot disagree about it.
  const editingPublished = geo.status === "geolocated";
  // Where a write that finishes with this row goes: back to the queue list on
  // its own, on to the next detection during a review pass, and to the event
  // itself after a version (`redirectTo`, which the page sets per surface).
  const finish = queue?.onAdvance ?? (() => router.push(redirectTo));

  // No tier at all on this surface: the flow action is the form's own Submit, at
  // the bottom where the fields it applies end, and sharing or reporting a row
  // one is in the middle of rewriting acts on a record that is not the one on
  // screen. The call stays because the grammar decides that, not the form
  // (`useEventActions`), and it hands back the slot the panels land in.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  // Close the detection: the confirm step is the inline `CloseEventForm` (a
  // required, publicly visible reason), so this flag only opens the panel. It
  // sits in the open beside Skip rather than behind the `⋯` menu: the menu is
  // for the rare management action on a reading surface, while working a detection
  // has three verbs (submit it, skip it, close it) and hiding one of them
  // behind a disclosure costs a click on every pass.
  const [closing, setClosing] = useState(false);

  const [title, setTitle] = useState(geo.title);
  // Coordinates + event date are optional on a detection, so seed the
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
  // A detection may be born with no declared source, so the field
  // starts empty (not `String(null)`) rather than showing a fabricated value.
  const [sourceUrl, setSourceUrl] = useState(geo.source_url ?? "");
  // A snapshot pasted here replaces whatever copy the detection carries, so the
  // field starts empty and the existing copy shows beside it instead: the value
  // is what to write, not what is stored.
  const [sourceSnapshotUrl, setSourceSnapshotUrl] = useState("");
  // The copy of the post a machine detection came from. Only the published-row
  // edit posts it, so only that shape wires the field: the provenance link is
  // immutable from the moment the detection exists, and archiving it is not a
  // change to it.
  const [detectedFromSnapshotUrl, setDetectedFromSnapshotUrl] = useState("");
  // The mirrors the import found, editable here: submitting replaces the whole
  // list, so a row the owner deletes is gone from the published event.
  const [secondarySourceUrls, setSecondarySourceUrls] = useState<string[]>(
    geo.secondary_source_urls
  );
  // One paste per mirror, empty for the same reason the source's is: the value
  // is what to write, and the copy a mirror already holds shows on its row.
  // `LinkListInput` keeps the two lists aligned through adds and removals.
  const [secondarySnapshotUrls, setSecondarySnapshotUrls] = useState<string[]>(
    geo.secondary_source_urls.map(() => "")
  );
  const [eventDate, setEventDate] = useState(geo.event_date ?? "");
  // The two inputs that hold less than the column does: `<input type="time">`
  // drops the seconds and `<input type="datetime-local">` stops at the minute.
  // What each was seeded with is kept, since a value still equal to it is a
  // field the analyst never touched, and posting the truncation back would take
  // the seconds off a published record on an edit that never went near it.
  const seededEventTime = geo.event_time?.slice(0, 5) ?? "";
  const seededSourcePostedAt = toDatetimeLocalUTC(geo.source_posted_at);
  const [eventTime, setEventTime] = useState(seededEventTime);
  const [sourcePostedAt, setSourcePostedAt] = useState(seededSourcePostedAt);
  // The graphic-content declaration the detection already carries, editable here.
  // Submitting posts the whole state, so an untouched switch re-posts the same
  // value rather than clearing it.
  const [isGraphic, setIsGraphic] = useState(geo.is_graphic);
  const [proof, setProof] = useState<Record<string, unknown> | null>(geo.proof);
  // Inline proof images the editor holds locally; uploaded as `proof_files[]`
  // at submit. A detection's existing proof images are already stored URLs in
  // the doc, so this set covers only newly-added images.
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  // The note that travels with the version this edit supersedes. Edit only:
  // there is no superseded version to annotate before publication.
  const [editNote, setEditNote] = useState("");

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

  // Everything both writes post, the evidence anchor included: both endpoints
  // declare the same fields, and a version records the anchor it supersedes.
  const buildCommon = () => ({
    title: title.trim(),
    source_url: sourceUrl.trim(),
    remove_media_ids: [...removedIds],
    files: newFiles,
    // Same strict parse as the two optional coordinate pairs, so one coordinate
    // can't read valid one way and invalid the other. Required here (the floor
    // check below runs first), so a NaN never reaches a submit.
    lat: cleanNumber(lat) ?? NaN,
    lng: cleanNumber(lng) ?? NaN,
    ...parseCaptureCoords(captureLat, captureLng),
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
  });

  // The one write this surface makes, in whichever shape the row is in. On a
  // detection, submit applies the whole form and flips the row to `geolocated`
  // in one atomic request; on a published event, saving a version applies the editable
  // fields and files the version it supersedes. The server enforces the same
  // evidence floor on both.
  const submitMutation = useMutation(
    () =>
      editingPublished
        ? saveVersion(geo.id, {
            ...buildCommon(),
            // An untouched lossy field is not posted as the truncation the input
            // holds. `source_posted_at` is dropped, which this endpoint alone
            // reads as "keep what the row holds"; `event_time` has no such
            // contract (an absent value clears it), so it goes back at the row's
            // own precision instead. Only the submit path posts either verbatim,
            // where there is no stored value to preserve.
            source_posted_at:
              sourcePostedAt === seededSourcePostedAt ? "" : sourcePostedAt,
            event_time:
              eventTime === seededEventTime
                ? (geo.event_time ?? undefined)
                : eventTime || undefined,
            detected_from_snapshot_url: detectedFromSnapshotUrl,
            note: editNote,
          })
        : geolocateEvent(geo.id, buildCommon()),
    {
      fallback: editingPublished ? "Couldn't save this version." : "Couldn't submit.",
      // The server is the authority on both version refusals, since the row may
      // have moved under a form that has been open a while. `nothing_changed`
      // therefore prints the server's own sentence, which names the version it
      // actually compared against rather than the one this page loaded; it is
      // word for word what the pre-submit check raises, so a reader never sees
      // two wordings for one verdict, and the loaded number stands in only if
      // the envelope arrives without a message. `version_limit` keeps the
      // server's message too, which carries the ceiling.
      onError: (err) =>
        err instanceof ApiError && err.code === "nothing_changed"
          ? err.message || nothingChangedMessage(geo.version_no)
          : undefined,
      onSuccess: () => {
        // The detections badge counts `detected` rows, which only the submit
        // path changes.
        if (!editingPublished) refreshDetectionCount();
        finish();
      },
    }
  );

  // Publishing is public and fixes the source, so it takes a second click. The
  // button arms in
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

  // The floor is computed on the post-edit state, on both writes alike: kept
  // existing media plus staged new files, and the selected curated tags. A
  // version re-checks the same floor server side, so a save that would leave
  // the published record without footage is caught here first.
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

  // What the version check reads: the editable state as the inputs hold it.
  const versionState = (): EventVersionFormState => ({
    title,
    sourceUrl,
    sourceMediaMoved: removedIds.size > 0 || newFiles.length > 0,
    lat,
    lng,
    captureLat,
    captureLng,
    eventDate,
    eventTime,
    sourcePostedAt,
    isGraphic,
    proof,
    tagIds: selectedTagIds,
    conflictIds: selectedConflictIds,
    secondarySourceUrls,
    secondarySnapshotUrls,
    sourceSnapshotUrl,
    detectedFromSnapshotUrl,
  });

  // Submit enforces the full floor (it publishes the row), then asks to confirm.
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
    // A snapshot that cannot be one, on the source or on any mirror, is caught
    // before the upload; the field flags itself red and the banner says what a
    // snapshot link looks like.
    if (
      [sourceSnapshotUrl, detectedFromSnapshotUrl, ...secondarySnapshotUrls].some(
        (pasted) => pasted.trim() && !isSnapshotUrl(pasted)
      )
    ) {
      submitMutation.setError(SNAPSHOT_HINT);
      return;
    }
    const missing = missingEventFields(fieldsState(), {
      requireMedia: true,
      requireTags: true,
      // A version matches what `save_version` accepts, which matches what publishing
      // a detection accepts: a row whose source post time was never resolved is
      // published with it blank, so an edit must not be blocked on filling it
      // in. Submitting a detection still requires it, as `geolocate` does.
      requireSourcePostedAt: !editingPublished,
    });
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    // A version adds a version, so it writes on the click that made it. A
    // submit publishes the row, so it arms the button and the
    // click after it writes; every check above runs on both clicks, so a form
    // that stopped being submittable between them says so instead of posting.
    if (editingPublished) {
      // A version has to change something. Caught here so a save with nothing
      // touched costs no request; the server refuses the same edit, and both
      // say it in the same words.
      if (!hasVersionChanges(geo, versionState())) {
        submitMutation.setError(nothingChangedMessage(geo.version_no));
        return;
      }
      void submitMutation.run();
      return;
    }
    triggerSubmit();
  };

  // The one label the flow action wears, and the sentence the confirm step
  // announces. Kept together so the button, its sizer and the status region
  // can't name the write three different ways.
  const CONFIRM_SENTENCE =
    "Click again to submit. Submitting publishes the event; later changes become versions.";
  // The number the save would produce, not the one on screen: the live row is
  // version N and this write files it as N and becomes N + 1, so the button
  // names what the reader is about to create.
  const nextVersion = geo.version_no + 1;
  const saveLabel = `Save version ${nextVersion}`;
  const widestLabel = editingPublished ? saveLabel : "Confirm submit";
  const submitLabel = editingPublished
    ? busy
      ? "Saving…"
      : saveLabel
    : busy
      ? "Submitting…"
      : submitArmed
        ? "Confirm submit"
        : "Submit";

  return (
    <PageShell
      back
      backFallback={redirectTo}
      title={editingPublished ? "Edit geolocation" : "Submit detection"}
      actions={
        // Everything that disposes of this detection rather than filling it in,
        // in the header's own cluster: the position and the way past it during
        // a review pass, then Close. Submit is the only action left at the foot
        // of the fields. A published event has none of those verbs (it is
        // neither skippable nor rejectable), so its header carries no cluster.
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          {queue && (
            <>
              <span className={LABEL_TEXT}>{queue.position}</span>
              <Button variant="secondary" onClick={queue.onAdvance} disabled={busy}>
                Skip
              </Button>
            </>
          )}
          {!editingPublished && (
            <Button
              variant="danger"
              onClick={() => setClosing(true)}
              disabled={busy || closing}
              aria-controls={CLOSE_PANEL_ID}
              aria-expanded={closing}
            >
              Close
            </Button>
          )}
          {actions}
        </div>
      }
    >
      {/* Under the header, where the trigger that opened it is. */}
      {panels}

      {/* The reason panel Close opens, in the same slot the shared action
          row's own panels use: under the header, below its trigger. */}
      {closing && (
        <div id={CLOSE_PANEL_ID}>
          <Card as="section">
            <SectionEyebrow title={closeActionLabel(geo.status)} margin="none" />
            <CloseEventForm
              eventId={geo.id}
              status={geo.status}
              disabled={busy}
              onClosed={() => {
                refreshDetectionCount();
                finish();
              }}
              onCancel={() => setClosing(false)}
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
          secondarySnapshotUrls={secondarySnapshotUrls}
          setSecondarySnapshotUrls={setSecondarySnapshotUrls}
          archivedCopies={archivedCopies(geo)}
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
          detectedFromUrl={geo.detected_from_url}
          // The provenance link's archive pair, on the one write that declares
          // the field. Passing the setter is what turns the locked field's mark
          // on, so the detection submit form renders it bare.
          detectedFromSnapshotUrl={detectedFromSnapshotUrl}
          setDetectedFromSnapshotUrl={
            editingPublished ? setDetectedFromSnapshotUrl : undefined
          }
          archivedDetectedFrom={geo.archived_detected_from}
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

        {/* The note rides with the version this edit supersedes, so it sits at
            the end of the fields it describes, next to the action that files
            them. Optional, and never part of the floor. */}
        {editingPublished && (
          <Card as="section">
            <SectionHeading title="Version note" concept="version_note" />
            <Input
              id="version_note"
              type="text"
              value={editNote}
              maxLength={VERSION_NOTE_MAX_LEN}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="What changed, and why"
              aria-label="Version note"
            />
          </Card>
        )}

        {/* Validation + errors sit right above the actions: the notice lists
            every missing field at once, the banner carries server failures. */}
        <IncompleteFormNotice
          key={validationAttempt}
          missing={missingFields.map((m) => m.label)}
        />
        {actionError && <div className={FORM_ERROR_BANNER}>{actionError}</div>}

        {/* The flow action, alone at the foot of the fields it applies, as on
            the create form. Disposing of the detection is not a form action: Skip
            and Close sit in the header. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Button
              ref={submitButtonRef}
              type="submit"
              variant="primary"
              disabled={busy}
              className={submitArmed ? ARMED_RING : ""}
              title={submitArmed ? CONFIRM_SENTENCE : undefined}
            >
              {/* The labels stack in one grid cell, so the button is as wide as
                  the longest of them from the first paint and arming moves
                  nothing at all, not even the `?` beside it. */}
              <span className="grid">
                <span aria-hidden className="col-start-1 row-start-1 invisible">
                  {widestLabel}
                </span>
                <span className="col-start-1 row-start-1">{submitLabel}</span>
              </span>
            </Button>
            {/* What the second click costs is the button's `?`, which every
                field on this form already carries, rather than a line of copy
                that appears mid-gesture and pushes the button sideways. A
                version adds a version, so it has nothing to warn about. */}
            {!editingPublished && <FieldHelp concept="action_submit" />}
          </span>
          {/* Sibling status region, the shape every copy control uses: the armed
              state is reported once, as a status, so a reader who cannot see
              the ring hears what the next click will do. */}
          <span className="sr-only" role="status" aria-live="polite">
            {submitArmed ? CONFIRM_SENTENCE : ""}
          </span>
        </div>
      </form>
    </PageShell>
  );
}
