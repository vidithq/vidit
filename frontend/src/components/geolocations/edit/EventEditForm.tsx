"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";

import { eventFormSlots, useEventForm } from "@/components/geolocations/EventFormFields";
import { Ellipsis } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { ARMED_RING } from "@/components/ui/styles";
import { FORM_ERROR_BANNER, LABEL_TEXT } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Button } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/CountBadge";
import { CloseEventDialog, closeActionLabel } from "@/components/event/CloseEventDialog";
import { EventShell } from "@/components/event/EventShell";
import { useGeolocatorsByline } from "@/components/event/useGeolocatorsByline";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { Input } from "@/components/ui/Input";
import { cleanNumber } from "@/lib/coordinates";
import {
  VERSION_NOTE_MAX_LEN,
  hasVersionChanges,
  missingEventFields,
  missingEventRequestFields,
  missingSummary,
  nothingChangedMessage,
  parseGuessCoords,
  saveVersion,
  updateEventRequest,
  type EventVersionFormState,
} from "@/lib/events";
import { sourceFloor, sourcesChanged, sourceWriteError } from "@/lib/sources";
import { eventHref } from "@/lib/routes";
import type { EventDetail } from "@/types";

// Ties the pinned actions, the version note and the Title field to the form, which they sit
// outside of.
const EDIT_FORM_ID = "event-edit-form";

const CONFIRM_SENTENCE =
  "Click again to publish. Publishing makes the event public as version 1; later changes become versions.";

/**
 * The one edit form of an event, in two shapes, each a write of `POST /events/{id}/versions`.
 *
 * **Publish** (a `requested` or `detected` row, version 0): the whole event is editable and
 * **Publish** applies the form and makes the row a geolocation at version 1, in one request.
 * The row as it stood stays readable as version 0. **Publish** counts the publish requirements
 * still missing, and the write takes a confirm, since publishing makes the event public. A detection is
 * the owner's to publish; a request is anyone's, and its owner may also **Save request**, which
 * overwrites it in place and leaves it version 0.
 *
 * **Save version** (a `geolocated` row): the same fields, and the write files the version it
 * supersedes. An optional note travels with that version. No confirm.
 *
 * Built like the create form: `EventShell`, `eventFormSlots`, `useEventForm`. State is seeded
 * from props (the form mounts after the row loaded), so the proof editor gets its
 * `initialContent` on first paint. Every write names the version the form was loaded at, so a
 * row that moved meanwhile answers a conflict instead of being overwritten.
 *
 * The fields fill `EventShell`'s zones. The actions block pins the writes, the banners and, for
 * the owner, **More actions** with the close; a published row's version note reads under them. A
 * published row's title section carries its geolocators byline, with the toggle that opens their
 * panel: those changes apply on click and never make a version.
 *
 * With `queue` set the actions gain the position and a Skip, and a finished detection hands over
 * to the next one.
 */
export function EventEditForm({
  geo,
  redirectTo,
  isOwner,
  queue,
  onCreditChanged,
}: {
  geo: EventDetail;
  /** Where a save or a close lands, and the back fallback. A published request opens its event. */
  redirectTo: string;
  /** Whether the reader owns the row: the close, a request's in-place save and the geolocators
   *  are the owner's. */
  isOwner: boolean;
  /** Runs after the owner changes the geolocators, so the page rereads the row. */
  onCreditChanged?: () => void;
  /** Set when this detection is one step of a review pass over the queue. */
  queue?: {
    /** `Detection n of m`. */
    position: string;
    /** Runs on Skip, and after a publish or a rejection. */
    onAdvance: () => void;
  };
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  // Read off the row so the page and the form cannot disagree about the mode.
  const editingPublished = geo.status === "geolocated";
  const isRequest = geo.status === "requested";
  const finish = queue?.onAdvance ?? (() => router.push(redirectTo));

  const form = useEventForm(geo);
  const credit = useGeolocatorsByline(geo, () => onCreditChanged?.());

  // Edit only: a publish files version 0, which keeps no note of its own.
  const [editNote, setEditNote] = useState("");
  const [closing, setClosing] = useState(false);

  // Live, so the count on Publish drops as the form fills.
  const floor = useMemo(() => sourceFloor(form.sources), [form.sources]);
  const publishMissing = useMemo(
    () =>
      missingEventFields({
        title: form.title,
        lat: form.lat,
        lng: form.lng,
        proof: form.proof,
        sources: floor,
        hasConflict: form.selectedConflictIds.length > 0,
      }),
    [form.title, form.lat, form.lng, form.proof, floor, form.selectedConflictIds]
  );

  const submitMutation = useMutation(
    () =>
      saveVersion(geo.id, {
        ...form.shared(),
        // Required (the floor check runs first), so a NaN never reaches a submit.
        lat: cleanNumber(form.lat) ?? NaN,
        lng: cleanNumber(form.lng) ?? NaN,
        version_no: geo.version_no,
        ...(editingPublished ? { note: editNote } : {}),
      }),
    {
      fallback: editingPublished ? "Couldn't save this version." : "Couldn't publish.",
      // The row may have moved under an open form, so `nothing_changed` prints
      // the server's sentence (it names the version actually compared against);
      // the loaded number is only the fallback. `version_limit` and
      // `version_mismatch` keep the server's message.
      onError: (err) =>
        err instanceof ApiError && err.code === "nothing_changed"
          ? err.message || nothingChangedMessage(geo.version_no)
          : sourceWriteError(err),
      onSuccess: () => {
        if (editingPublished) {
          finish();
          return;
        }
        // The badge counts `detected` rows, which a publish removes.
        if (!isRequest) refreshDetectionCount();
        // A published request opens as the event it now is.
        if (isRequest) router.push(eventHref(geo.id));
        else finish();
      },
    }
  );

  // The requester's in-place save of an open request: no version, and the request floor only.
  const saveRequestMutation = useMutation(
    () =>
      updateEventRequest(geo.id, {
        ...form.shared(),
        // Both-or-neither parse, so a half-typed pair is dropped, not a 400.
        ...parseGuessCoords(form.lat, form.lng),
      }),
    {
      fallback: "Couldn't save this request.",
      onError: sourceWriteError,
      onSuccess: () => router.push(redirectTo),
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

  const busy = submitMutation.loading || saveRequestMutation.loading;
  const actionError = submitMutation.error ?? saveRequestMutation.error;

  const resetActions = () => {
    submitMutation.reset();
    saveRequestMutation.reset();
    form.clearIncomplete();
  };

  const versionState = (): EventVersionFormState => ({
    title: form.title,
    sourcesMoved: sourcesChanged(geo.sources, form.sources),
    lat: form.lat,
    lng: form.lng,
    eventDate: form.eventDate,
    eventTime: form.eventTime,
    proof: form.proof,
    tagIds: form.selectedTagIds,
    conflictIds: form.selectedConflictIds,
  });

  // The write enforces the full floor; a publish then asks to confirm. An incomplete form
  // surfaces the notice instead.
  const attemptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetActions();
    // The taxonomy must be loaded before the floor can tell "didn't pick one"
    // from "still loading".
    if (form.taxonomy.blockedMessage !== null) {
      submitMutation.setError(form.taxonomy.blockedMessage);
      return;
    }
    if (publishMissing.length) {
      form.flagIncomplete(publishMissing);
      return;
    }
    // A running upload or a refused archived copy holds the write.
    const blocked = sourcesBlockWrite(form.sources);
    if (blocked) {
      submitMutation.setError(blocked);
      return;
    }
    // A version writes on the first click; a publish arms and writes on the
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

  const attemptSaveRequest = () => {
    resetActions();
    const missing = missingEventRequestFields({ title: form.title, sources: floor });
    if (missing.length) {
      form.flagIncomplete(missing);
      return;
    }
    const blocked = sourcesBlockWrite(form.sources);
    if (blocked) {
      saveRequestMutation.setError(blocked);
      return;
    }
    void saveRequestMutation.run();
  };

  // The version the save produces (live row N becomes N + 1).
  const saveLabel = `Save version ${geo.version_no + 1}`;
  const widestLabel = editingPublished ? saveLabel : "Confirm publish";
  const submitLabel = editingPublished
    ? submitMutation.loading
      ? "Saving…"
      : saveLabel
    : submitMutation.loading
      ? "Publishing…"
      : submitArmed
        ? "Confirm publish"
        : "Publish";

  const title = editingPublished
    ? "Edit geolocation"
    : isRequest
      ? isOwner
        ? "Edit request"
        : "Geolocate request"
      : "Publish detection";

  const actions = (
    <aside aria-label="Actions" className="space-y-3">
      {/* The review pass's own chrome. A plain edit has none. */}
      {queue && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={LABEL_TEXT}>{queue.position}</span>
          <Button variant="secondary" onClick={queue.onAdvance} disabled={busy}>
            Skip
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5">
          {/* A published row's save needs the same floor, but only a publish counts it. */}
          <CountBadge
            count={editingPublished ? 0 : publishMissing.length}
            label={missingSummary(publishMissing)}
          >
            {(describedBy) => (
              <Button
                ref={submitButtonRef}
                type="submit"
                form={EDIT_FORM_ID}
                variant="primary"
                disabled={busy}
                className={submitArmed ? ARMED_RING : ""}
                title={submitArmed ? CONFIRM_SENTENCE : undefined}
                aria-describedby={describedBy}
              >
                {/* Labels stack in one grid cell so arming never resizes the button. */}
                <span className="grid">
                  <span aria-hidden className="col-start-1 row-start-1 invisible">
                    {widestLabel}
                  </span>
                  <span className="col-start-1 row-start-1">{submitLabel}</span>
                </span>
              </Button>
            )}
          </CountBadge>
          {!editingPublished && <FieldHelp concept="action_publish" />}
        </span>
        {/* No confirm: the in-place save publishes nothing and files no version. */}
        {isRequest && isOwner && (
          <Button variant="secondary" onClick={attemptSaveRequest} disabled={busy}>
            {saveRequestMutation.loading ? "Saving…" : "Save request"}
          </Button>
        )}
        {isOwner && (
          <ActionMenu
            label="More actions"
            icon={<Ellipsis size={14} />}
            items={[
              {
                key: "close",
                label: closeActionLabel(geo.status),
                onSelect: () => setClosing(true),
              },
            ]}
          />
        )}
        {/* Announces the armed state to screen readers. */}
        <span className="sr-only" role="status" aria-live="polite">
          {submitArmed ? CONFIRM_SENTENCE : ""}
        </span>
      </div>

      <IncompleteFormNotice
        key={form.validationAttempt}
        missing={form.missingFields.map((m) => m.label)}
      />
      {actionError && <div className={FORM_ERROR_BANNER}>{actionError}</div>}

      {closing && (
        <CloseEventDialog
          eventId={geo.id}
          status={geo.status}
          disabled={busy}
          onCancel={() => setClosing(false)}
          onClosed={() => {
            if (geo.status === "detected") refreshDetectionCount();
            finish();
          }}
        />
      )}
    </aside>
  );

  const fields = eventFormSlots(form, { row: geo, showProvenance: true, formId: EDIT_FORM_ID });

  return (
    <EventShell
      title={title}
      byline={editingPublished && credit.byline}
      belowTitle={
        <>
          {editingPublished && credit.panel}
          {fields.titleField}
        </>
      }
      backFallback={redirectTo}
      actions={{
        pinned: actions,
        // Optional, never part of the floor. Outside the `<form>`, so it joins it through `form`,
        // and Enter in it still saves.
        below: editingPublished && (
          <Card as="section">
            <SectionHeading title="Version note" concept="version_note" />
            <Input
              id="version_note"
              type="text"
              form={EDIT_FORM_ID}
              value={editNote}
              maxLength={VERSION_NOTE_MAX_LEN}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="What changed, and why"
              aria-label="Version note"
            />
          </Card>
        ),
      }}
      body={{
        ...fields.body,
        // `noValidate`: IncompleteFormNotice owns required-field feedback.
        form: { id: EDIT_FORM_ID, onSubmit: attemptSubmit, noValidate: true },
      }}
    />
  );
}
