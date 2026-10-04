"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";

import {
  EventFormFields,
  useEventForm,
} from "@/components/geolocations/EventFormFields";
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
import { closeActionLabel, CloseEventForm } from "@/components/event/CloseEventForm";
import { useEventActions } from "@/components/event/useEventActions";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { Input } from "@/components/ui/Input";
import { cleanNumber } from "@/lib/coordinates";
import {
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
import type { EventDetail } from "@/types";

// Ties Close to the reason panel it opens, which is not its DOM sibling.
const CLOSE_PANEL_ID = "close-detection-form";

/**
 * Owner edit of one event, in two shapes.
 *
 * **Submit** (a machine-`detected` row): the owner curates the whole detection
 * and submits it, which applies the form and flips the row to `geolocated` in
 * one atomic multipart request. Only `detected_from_url` is immutable. The
 * write takes a confirm, since publishing makes the event public.
 *
 * **Save version** (a `geolocated` row): the same fields, and the write files
 * the version it supersedes instead of overwriting it. An optional note travels
 * with that version. No confirm.
 *
 * Built like the create form: `EventFormFields`, `useEventForm`, `MediaManager`.
 * State is seeded from props (the form mounts after the row loaded), so Tiptap
 * gets its `initialContent` on first paint.
 *
 * With `queue` set the header gains the position and a Skip, and a finished
 * detection hands over to the next one.
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
    /** `Detection n of m`. */
    position: string;
    /** Runs on Skip, and after a submit or a rejection. */
    onAdvance: () => void;
  };
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  // Read off the row so the page and the form cannot disagree about the mode.
  const editingPublished = geo.status === "geolocated";
  const finish = queue?.onAdvance ?? (() => router.push(redirectTo));

  // No action tier on this surface (the grammar in `useEventActions` decides);
  // the call stays for the slot the panels land in.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  // Only opens the inline `CloseEventForm` (the confirm step). Close sits beside
  // Skip, not in the `⋯` menu: working a detection has three verbs.
  const [closing, setClosing] = useState(false);

  const form = useEventForm(geo);

  // Only the published-row edit posts it: the provenance link itself is
  // immutable.
  const [detectedFromSnapshotUrl, setDetectedFromSnapshotUrl] = useState("");
  // Edit only: a detection has no superseded version to annotate.
  const [editNote, setEditNote] = useState("");

  // Everything both writes post, the evidence anchor included.
  const buildCommon = () => ({
    ...form.shared(),
    title: form.title.trim(),
    source_url: form.sourceUrl.trim(),
    remove_media_ids: [...form.removedIds],
    files: form.newFiles,
    // Same strict parse as the optional pairs. Required here (the floor check
    // runs first), so a NaN never reaches a submit.
    lat: cleanNumber(form.lat) ?? NaN,
    lng: cleanNumber(form.lng) ?? NaN,
    ...parseCaptureCoords(form.captureLat, form.captureLng),
  });

  const submitMutation = useMutation(
    () =>
      editingPublished
        ? saveVersion(geo.id, {
            ...buildCommon(),
            // An untouched lossy field is not posted as the input's truncation.
            // `source_posted_at` is dropped (this endpoint reads that as "keep");
            // an absent `event_time` clears it, so it goes back at the row's own
            // precision.
            source_posted_at:
              form.sourcePostedAt === form.seeded.sourcePostedAt
                ? ""
                : form.sourcePostedAt,
            event_time:
              form.eventTime === form.seeded.eventTime
                ? (geo.event_time ?? undefined)
                : form.eventTime || undefined,
            detected_from_snapshot_url: detectedFromSnapshotUrl,
            note: editNote,
          })
        : geolocateEvent(geo.id, buildCommon()),
    {
      fallback: editingPublished ? "Couldn't save this version." : "Couldn't submit.",
      // The row may have moved under an open form, so `nothing_changed` prints
      // the server's sentence (it names the version actually compared against);
      // the loaded number is only the fallback. `version_limit` keeps the
      // server's message, which carries the ceiling.
      onError: (err) =>
        err instanceof ApiError && err.code === "nothing_changed"
          ? err.message || nothingChangedMessage(geo.version_no)
          : undefined,
      onSuccess: () => {
        // The badge counts `detected` rows, which only submit changes.
        if (!editingPublished) refreshDetectionCount();
        finish();
      },
    }
  );

  // Publishing is public, so it takes a second click. The button arms in place
  // and keeps focus, so Enter twice submits too.
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

  // The floor reads the post-edit state: kept media plus staged files, and the
  // selected curated tags. The server re-checks it on a version.
  const keptMediaCount =
    geo.media.filter((m) => !form.removedIds.has(m.id)).length +
    form.newFiles.length;
  const selectedCurated = form.taxonomy.curatedTags.filter((t) =>
    form.selectedTagIds.includes(t.id)
  );

  const fieldsState = (): EventFieldsState => ({
    title: form.title,
    lat: form.lat,
    lng: form.lng,
    sourceUrl: form.sourceUrl,
    sourcePostedAt: form.sourcePostedAt,
    proof: form.proof,
    mediaCount: keptMediaCount,
    hasConflictTag: form.selectedConflictIds.length > 0,
    hasCaptureSourceTag: selectedCurated.some(
      (t) => t.category === "capture_source"
    ),
  });

  const versionState = (): EventVersionFormState => ({
    title: form.title,
    sourceUrl: form.sourceUrl,
    sourceMediaMoved: form.removedIds.size > 0 || form.newFiles.length > 0,
    lat: form.lat,
    lng: form.lng,
    captureLat: form.captureLat,
    captureLng: form.captureLng,
    eventDate: form.eventDate,
    eventTime: form.eventTime,
    sourcePostedAt: form.sourcePostedAt,
    isGraphic: form.isGraphic,
    proof: form.proof,
    tagIds: form.selectedTagIds,
    conflictIds: form.selectedConflictIds,
    secondarySourceUrls: form.secondarySourceUrls,
    secondarySnapshotUrls: form.secondarySnapshotUrls,
    sourceSnapshotUrl: form.sourceSnapshotUrl,
    detectedFromSnapshotUrl,
  });

  // Submit enforces the full floor, then asks to confirm; an incomplete
  // detection surfaces the notice instead.
  const attemptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.reset();
    form.clearIncomplete();
    // The taxonomy must be loaded before the floor can tell "didn't pick one"
    // from "still loading".
    if (form.taxonomy.blockedMessage !== null) {
      submitMutation.setError(form.taxonomy.blockedMessage);
      return;
    }
    // A snapshot that cannot be one is caught before the upload.
    if (
      [
        form.sourceSnapshotUrl,
        detectedFromSnapshotUrl,
        ...form.secondarySnapshotUrls,
      ].some((pasted) => pasted.trim() && !isSnapshotUrl(pasted))
    ) {
      submitMutation.setError(SNAPSHOT_HINT);
      return;
    }
    const missing = missingEventFields(fieldsState(), {
      requireMedia: true,
      requireTags: true,
      // Matches `save_version`: a published row may have a blank source post
      // time. `geolocate` still requires it.
      requireSourcePostedAt: !editingPublished,
    });
    if (missing.length) {
      form.flagIncomplete(missing);
      return;
    }
    // A version writes on the first click; a submit arms and writes on the
    // second. Every check above runs on both clicks.
    if (editingPublished) {
      // The server refuses the same edit with the same words.
      if (!hasVersionChanges(geo, versionState())) {
        submitMutation.setError(nothingChangedMessage(geo.version_no));
        return;
      }
      void submitMutation.run();
      return;
    }
    triggerSubmit();
  };

  const CONFIRM_SENTENCE =
    "Click again to submit. Submitting publishes the event; later changes become versions.";
  // The version the save produces (live row N becomes N + 1).
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
        // Verbs that dispose of the detection. A published event has none.
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
      {panels}

      {/* The reason panel Close opens. */}
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

      {/* `noValidate`: IncompleteFormNotice owns required-field feedback. */}
      <form onSubmit={attemptSubmit} className="space-y-6" noValidate>
        <EventFormFields
          form={form}
          row={geo}
          showProvenance
          detectedFromSnapshotUrl={detectedFromSnapshotUrl}
          // Passing the setter turns the locked field's archive mark on.
          setDetectedFromSnapshotUrl={
            editingPublished ? setDetectedFromSnapshotUrl : undefined
          }
        />

        {/* Optional, never part of the floor. */}
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

        <IncompleteFormNotice
          key={form.validationAttempt}
          missing={form.missingFields.map((m) => m.label)}
        />
        {actionError && <div className={FORM_ERROR_BANNER}>{actionError}</div>}

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
              {/* Labels stack in one grid cell so arming never resizes the button. */}
              <span className="grid">
                <span aria-hidden className="col-start-1 row-start-1 invisible">
                  {widestLabel}
                </span>
                <span className="col-start-1 row-start-1">{submitLabel}</span>
              </span>
            </Button>
            {!editingPublished && <FieldHelp concept="action_submit" />}
          </span>
          {/* Announces the armed state to screen readers. */}
          <span className="sr-only" role="status" aria-live="polite">
            {submitArmed ? CONFIRM_SENTENCE : ""}
          </span>
        </div>
      </form>
    </PageShell>
  );
}
