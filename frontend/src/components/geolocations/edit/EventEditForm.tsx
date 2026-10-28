"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError } from "@/lib/api";

import { EventFormShell, useEventForm } from "@/components/geolocations/EventFormFields";
import {
  PUBLISH_CONFIRM,
  PublishActions,
  SAVING_LABEL,
  publishGeolocationButton,
  requestWriteButton,
} from "@/components/geolocations/PublishActions";
import { WRITE_FALLBACK, useEventWrite, writeGroup } from "@/components/geolocations/useEventWrite";

import { LABEL_TEXT } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { CloseEventDialog, closeActionLabel } from "@/components/event/CloseEventDialog";
import {
  GeolocatorsByline,
  useDraftGeolocatorsByline,
} from "@/components/event/useGeolocatorsByline";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { VersionNotePanel } from "@/components/event/VersionNotePanel";
import {
  hasVersionChanges,
  nothingChangedMessage,
  saveVersion,
  updateEventRequest,
  type EventVersionFormState,
} from "@/lib/events";
import { sourcesChanged } from "@/lib/sources";
import { eventHref } from "@/lib/routes";
import type { EventDetail } from "@/types";

// Ties the pinned write buttons and the Title field to the form, which they sit outside of.
const EDIT_FORM_ID = "event-edit-form";

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
 * supersedes. The first click asks for the optional note that travels with that version, in a
 * panel on the button, whose save writes. A change to the Linked sites alone reads **Save** and
 * files no version.
 *
 * Built like the create form: `EventShell`, `eventFormSlots`, `useEventForm`. State is seeded
 * from props (the form mounts after the row loaded), so the proof editor gets its
 * `initialContent` on first paint. Every write names the version the form was loaded at, so a
 * row that moved meanwhile answers a conflict instead of being overwritten.
 *
 * The actions block pins the writes (`PublishActions`), the error banner and, for the owner, the
 * close. The title section's byline manages the geolocators in place: on a published row each
 * change applies on click and never makes a version; on a request or a detection the reader
 * picks the co-geolocators the publish invites.
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

  const versionChanged = editingPublished && hasVersionChanges(geo, versionState());
  const linksOnly = editingPublished && !versionChanged && form.siteLinks.changed;
  const save = () =>
    saveVersion(geo.id, {
      ...form.publishInput(editingPublished ? undefined : draftCredit.invitees),
      version_no: geo.version_no,
      ...(editingPublished && { note: editNote }),
    });

  // The write enforces the full floor on every click. A version asks for its note in a panel on
  // the button; a publish is public, so it arms and writes on the second click. The Linked sites
  // are no part of a version: a published row writes them first, since each link write is
  // idempotent and a retry after a refused version rewrites them; a publish writes them once the
  // row is published, and a refused link never holds it.
  const submit = useEventWrite(form, {
    floor: "publish",
    post: async () => {
      if (editingPublished) {
        await form.siteLinks.save(geo.id);
        return versionChanged ? save() : null;
      }
      const published = await save();
      await form.siteLinks.save(geo.id).catch(() => undefined);
      return published;
    },
    fallback: editingPublished ? WRITE_FALLBACK.version : WRITE_FALLBACK.publish,
    // The row may have moved under an open form, so `nothing_changed` prints the server's sentence
    // (it names the version actually compared against); the loaded number is only the fallback.
    // `version_limit` and `version_mismatch` keep the server's message.
    onError: (err) =>
      err instanceof ApiError && err.code === "nothing_changed"
        ? err.message || nothingChangedMessage(geo.version_no)
        : undefined,
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
    confirm: editingPublished ? undefined : PUBLISH_CONFIRM,
    ask: versionChanged,
    // The server refuses the same edit with the same words.
    extraCheck: () =>
      editingPublished && !versionChanged && !form.siteLinks.changed
        ? nothingChangedMessage(geo.version_no)
        : null,
    resetAll: () => writes.reset(),
  });

  // The requester's in-place save of an open request: no version, the request floor only, and no
  // confirm, since it publishes nothing.
  const saveRequest = useEventWrite(form, {
    floor: "request",
    post: () => updateEventRequest(geo.id, form.requestInput()),
    fallback: WRITE_FALLBACK.saveRequest,
    onSuccess: () => router.push(redirectTo),
    resetAll: () => writes.reset(),
  });
  const writes = writeGroup(submit, saveRequest);

  const title = editingPublished
    ? "Edit geolocation"
    : isRequest
      ? isOwner
        ? "Edit request"
        : "Geolocate request"
      : "Publish detection";

  // The version the save produces (live row N becomes N + 1). A change to the Linked sites alone
  // files no version.
  const saveLabel = linksOnly ? "Save" : `Save version ${geo.version_no + 1}`;

  const actions = (
    <PublishActions
      disabled={writes.busy}
      error={writes.error}
      help={editingPublished ? undefined : "action_publish"}
      // The review pass's own chrome. A plain edit has none.
      lead={
        queue && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <span className={LABEL_TEXT}>{queue.position}</span>
            <Button
              action="skip"
              variant="secondary"
              onClick={queue.onAdvance}
              disabled={writes.busy}
            >
              Skip
            </Button>
          </div>
        )
      }
      buttons={[
        editingPublished
          ? {
              action: submit.action,
              label: saveLabel,
              busyLabel: SAVING_LABEL,
              busy: submit.busy,
              variant: "primary",
              icon: "save",
              form: EDIT_FORM_ID,
              ask: {
                label: "Version note",
                content: (
                  <VersionNotePanel
                    note={editNote}
                    setNote={setEditNote}
                    saveLabel={saveLabel}
                    onSave={submit.action.confirmAsk}
                  />
                ),
              },
            }
          : { ...publishGeolocationButton(submit, "Publish"), form: EDIT_FORM_ID },
        ...(isRequest && isOwner
          ? [requestWriteButton(saveRequest, "Save request", SAVING_LABEL)]
          : []),
      ]}
      trailing={
        isOwner && (
          <>
            {/* The close is destructive and asks first, so it shows as a red trash beside the
                write. */}
            <RemoveButton
              confirms
              label={closeActionLabel(geo.status)}
              onClick={() => setClosing(true)}
            />
            {closing && (
              <CloseEventDialog
                eventId={geo.id}
                status={geo.status}
                disabled={writes.busy}
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

  return (
    <EventFormShell
      form={form}
      title={title}
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
      actions={actions}
      formId={EDIT_FORM_ID}
      onSubmit={submit.action.attempt}
      fields={{ row: geo, siteLinks: !isRequest }}
    />
  );
}
