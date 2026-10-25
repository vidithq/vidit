"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";

import { eventFormSlots, useEventForm } from "@/components/geolocations/EventFormFields";
import { PublishActions, usePublishAction } from "@/components/geolocations/PublishActions";
import { Ban, MapPin, Megaphone, Save } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { LABEL_TEXT } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Button } from "@/components/ui/Button";
import { CloseEventDialog, closeActionLabel } from "@/components/event/CloseEventDialog";
import { EventShell } from "@/components/event/EventShell";
import {
  GeolocatorsByline,
  useDraftGeolocatorsByline,
} from "@/components/event/useGeolocatorsByline";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useMutation } from "@/hooks/useMutation";
import { Input } from "@/components/ui/Input";
import { cleanNumber } from "@/lib/coordinates";
import {
  VERSION_NOTE_MAX_LEN,
  hasVersionChanges,
  missingEventFields,
  missingEventRequestFields,
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
 * The fields fill `EventShell`'s zones. The actions block pins the writes (`PublishActions`), the
 * error banner and, for the owner, the close as a red icon button; the incomplete-form notice and
 * a published row's version note read under them.
 * The title section's byline manages the geolocators in place: on a published row each change
 * applies on click and never makes a version; on a request or a detection the reader picks the
 * co-geolocators the publish invites.
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
  // The publish posts the picks; Save request posts none.
  const draftCredit = useDraftGeolocatorsByline();

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
  const requestMissing = useMemo(
    () => missingEventRequestFields({ title: form.title, sources: floor }),
    [form.title, floor]
  );

  const submitMutation = useMutation(
    () =>
      saveVersion(geo.id, {
        ...form.shared(),
        // Required (the floor check runs first), so a NaN never reaches a submit.
        lat: cleanNumber(form.lat) ?? NaN,
        lng: cleanNumber(form.lng) ?? NaN,
        version_no: geo.version_no,
        ...(editingPublished
          ? { note: editNote }
          : { geolocator_invites: draftCredit.invitees }),
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

  // The write enforces the full floor on every click. A version writes on the first click; a
  // publish is public, so it arms and writes on the second. An incomplete form surfaces the
  // notice instead.
  const submit = usePublishAction({
    check: () => {
      resetActions();
      // The taxonomy must be loaded before the floor can tell "didn't pick one"
      // from "still loading".
      if (form.taxonomy.blockedMessage !== null) {
        submitMutation.setError(form.taxonomy.blockedMessage);
        return false;
      }
      if (publishMissing.length) {
        form.flagIncomplete(publishMissing);
        return false;
      }
      // A running upload or a refused archived copy holds the write.
      const blocked = sourcesBlockWrite(form.sources);
      if (blocked) {
        submitMutation.setError(blocked);
        return false;
      }
      // The server refuses the same edit with the same words.
      if (editingPublished && !hasVersionChanges(geo, versionState())) {
        submitMutation.setError(nothingChangedMessage(geo.version_no));
        return false;
      }
      return true;
    },
    write: () => void submitMutation.run(),
    confirm: editingPublished ? undefined : CONFIRM_SENTENCE,
  });

  // No confirm: the in-place save publishes nothing and files no version.
  const saveRequest = usePublishAction({
    check: () => {
      resetActions();
      if (requestMissing.length) {
        form.flagIncomplete(requestMissing);
        return false;
      }
      const blocked = sourcesBlockWrite(form.sources);
      if (blocked) {
        saveRequestMutation.setError(blocked);
        return false;
      }
      return true;
    },
    write: () => void saveRequestMutation.run(),
  });

  const title = editingPublished
    ? "Edit geolocation"
    : isRequest
      ? isOwner
        ? "Edit request"
        : "Geolocate request"
      : "Publish detection";

  const actions = (
    <PublishActions
      disabled={busy}
      error={actionError}
      help={editingPublished ? undefined : "action_publish"}
      // The review pass's own chrome. A plain edit has none.
      lead={
        queue && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <span className={LABEL_TEXT}>{queue.position}</span>
            <Button variant="secondary" onClick={queue.onAdvance} disabled={busy}>
              Skip
            </Button>
          </div>
        )
      }
      buttons={[
        editingPublished
          ? {
              action: submit,
              // The version the save produces (live row N becomes N + 1).
              label: `Save version ${geo.version_no + 1}`,
              busyLabel: "Saving…",
              busy: submitMutation.loading,
              variant: "primary",
              icon: <Save size={14} strokeWidth={2} />,
              form: EDIT_FORM_ID,
            }
          : {
              action: submit,
              label: "Publish",
              busyLabel: "Publishing…",
              busy: submitMutation.loading,
              variant: "primary",
              icon: <MapPin size={14} strokeWidth={2} />,
              missing: publishMissing,
              form: EDIT_FORM_ID,
            },
        ...(isRequest && isOwner
          ? [
              {
                action: saveRequest,
                label: "Save request",
                busyLabel: "Saving…",
                busy: saveRequestMutation.loading,
                variant: "secondary" as const,
                icon: <Megaphone size={14} strokeWidth={2} />,
                missing: requestMissing,
              },
            ]
          : []),
      ]}
      trailing={
        isOwner && (
          <>
            {/* The close is destructive, so it shows as itself, red, beside the write. */}
            <Button
              icon
              variant="dangerGhost"
              aria-label={closeActionLabel(geo.status)}
              onClick={() => setClosing(true)}
            >
              <Ban size={14} />
            </Button>
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
          </>
        )
      }
    />
  );

  const fields = eventFormSlots(form, { row: geo, showProvenance: true, formId: EDIT_FORM_ID });

  return (
    <EventShell
      title={title}
      titleField={fields.titleField}
      // Invitations go out on a geolocated row only, or with the publish. Mirrors backend
      // geolocator_credit._require_published; change both.
      byline={
        editingPublished ? (
          <GeolocatorsByline event={geo} onChanged={() => onCreditChanged?.()} />
        ) : (
          draftCredit.byline
        )
      }
      backFallback={redirectTo}
      actions={{
        pinned: actions,
        // Optional, never part of the floor. Outside the `<form>`, so it joins it through `form`,
        // and Enter in it still saves.
        below: (
          <div className="space-y-4">
            <IncompleteFormNotice
              key={form.validationAttempt}
              missing={form.missingFields.map((m) => m.label)}
            />
            {/* Optional, never part of the floor. Outside the `<form>`, so it joins it through
                `form`, and Enter in it still saves. */}
            {editingPublished && (
              <section>
                <SectionEyebrow title="Version note" concept="version_note" />
                <Card>
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
              </section>
            )}
          </div>
        ),
      }}
      body={{
        ...fields.body,
        // `noValidate`: IncompleteFormNotice owns required-field feedback.
        form: {
          id: EDIT_FORM_ID,
          onSubmit: (e) => {
            e.preventDefault();
            submit.attempt();
          },
          noValidate: true,
        },
      }}
    />
  );
}
