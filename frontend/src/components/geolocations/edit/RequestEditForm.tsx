"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { PageShell } from "@/components/ui/PageShell";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Button } from "@/components/ui/Button";
import {
  TaxonomyFields,
  useTaxonomy,
} from "@/components/geolocations/TaxonomyFields";
import { useEventActions } from "@/components/event/useEventActions";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import {
  archivedCopies,
  missingEventRequestFields,
  parseCaptureCoords,
  parseGuessCoords,
  updateEventRequest,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import type { EventDetail } from "@/types";

/**
 * Owner edit of an open request, the third shape of the one edit address.
 *
 * A request is a question rather than a vouched claim, so this write overwrites
 * the row: no version is filed, the id, the requester and the provenance of a
 * bot-opened row stay put, and the owner lands back on the request. The fields
 * are the ones the submit form writes when it posts a request, built from the
 * same bricks in the same order, so an analyst who opened a request by hand
 * edits it in the surface they filled.
 *
 * The floor is the request floor, not the geolocation one: a title, the source,
 * and the footage. The coordinate is what a request is asking for, so placing
 * one here does not publish anything; the geolocate does, through
 * `/submit?request_id=`. The source instant is not part of the floor on this
 * surface, since the bot opens requests whose source date it could not read.
 */
export function RequestEditForm({
  geo,
  redirectTo,
}: {
  geo: EventDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  // No tier on this surface, the shape the published edit form takes: the flow
  // action is the Save at the foot of the fields it applies, and sharing or
  // reporting a row one is in the middle of rewriting acts on a record that is
  // not the one on screen. The call stays because the grammar decides that, not
  // the form.
  const { actions, panels } = useEventActions({ event: geo, surface: "edit" });

  const [title, setTitle] = useState(geo.title);
  // The approximate guess, optional on a request and editable here: seeded
  // empty (not `String(null)`) when the row carries none.
  const [lat, setLat] = useState(
    geo.event_coords ? String(geo.event_coords.lat) : ""
  );
  const [lng, setLng] = useState(
    geo.event_coords ? String(geo.event_coords.lng) : ""
  );
  const [captureLat, setCaptureLat] = useState(
    geo.capture_source_coords ? String(geo.capture_source_coords.lat) : ""
  );
  const [captureLng, setCaptureLng] = useState(
    geo.capture_source_coords ? String(geo.capture_source_coords.lng) : ""
  );
  // A `requested` row always carries a source URL (`ck_events_source_url_status`
  // ties it to the status); the `?? ""` only satisfies the nullable wire type.
  const [sourceUrl, setSourceUrl] = useState(geo.source_url ?? "");
  // A snapshot pasted here replaces whatever copy the link carries, so the field
  // starts empty and the stored copy shows beside it: the value is what to
  // write, not what is stored.
  const [sourceSnapshotUrl, setSourceSnapshotUrl] = useState("");
  const [secondarySourceUrls, setSecondarySourceUrls] = useState<string[]>(
    geo.secondary_source_urls
  );
  const [secondarySnapshotUrls, setSecondarySnapshotUrls] = useState<string[]>(
    geo.secondary_source_urls.map(() => "")
  );
  const [eventDate, setEventDate] = useState(geo.event_date ?? "");
  // The two inputs that hold less than the column does: `<input type="time">`
  // drops the seconds and `<input type="datetime-local">` stops at the minute.
  // What each was seeded with is kept, so a field the analyst never touched goes
  // back at the row's own precision rather than as the truncation on screen.
  const seededEventTime = geo.event_time?.slice(0, 5) ?? "";
  const seededSourcePostedAt = toDatetimeLocalUTC(geo.source_posted_at);
  const [eventTime, setEventTime] = useState(seededEventTime);
  const [sourcePostedAt, setSourcePostedAt] = useState(seededSourcePostedAt);
  const [isGraphic, setIsGraphic] = useState(geo.is_graphic);
  const [proof, setProof] = useState<Record<string, unknown> | null>(geo.proof);
  // Inline proof images the editor holds locally, uploaded as `proof_files[]` at
  // save. The request's existing images are already stored URLs in the doc, so
  // this set covers only newly-added ones.
  const [proofFiles, setProofFiles] = useState<File[]>([]);

  // Media is staged and applied on save, as on the published edit: the stored
  // row is marked for removal and the replacement queued for upload.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const taxonomy = useTaxonomy();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    geo.tags.map((t) => t.id)
  );
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>(
    geo.conflicts.map((c) => c.id)
  );

  const {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
  } = useIncompleteForm();

  const keptMediaCount =
    geo.media.filter((m) => !removedIds.has(m.id)).length + newFiles.length;

  const saveMutation = useMutation(
    () =>
      updateEventRequest(geo.id, {
        title: title.trim(),
        source_url: sourceUrl.trim(),
        source_snapshot_url: sourceSnapshotUrl,
        secondary_source_urls: secondarySourceUrls,
        secondary_snapshot_urls: secondarySnapshotUrls,
        proof,
        // The optional guess and the optional camera point, on the same strict
        // both-or-neither parse the submit form runs, so a half-typed pair is
        // dropped rather than posted as a 400.
        ...parseGuessCoords(lat, lng),
        ...parseCaptureCoords(captureLat, captureLng),
        event_date: eventDate || undefined,
        // An untouched lossy input is not posted as the truncation it holds: the
        // row's own value goes back instead, at the precision it was stored in.
        event_time:
          eventTime === seededEventTime
            ? (geo.event_time ?? undefined)
            : eventTime || undefined,
        source_posted_at:
          sourcePostedAt === seededSourcePostedAt
            ? (geo.source_posted_at ?? "")
            : sourcePostedAt,
        is_graphic: isGraphic,
        tag_ids: selectedTagIds,
        conflict_ids: selectedConflictIds,
        remove_media_ids: [...removedIds],
        files: newFiles,
        proof_files: proofFiles,
      }),
    {
      fallback: "Couldn't save this request.",
      onSuccess: () => router.push(redirectTo),
    }
  );

  const busy = saveMutation.loading;

  const attemptSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.reset();
    clearIncomplete();
    // A pasted snapshot that cannot be one, on the source or on any mirror, is
    // caught before the upload: the field flags itself red and the banner says
    // what a snapshot link looks like.
    if (
      [sourceSnapshotUrl, ...secondarySnapshotUrls].some(
        (pasted) => pasted.trim() && !isSnapshotUrl(pasted)
      )
    ) {
      saveMutation.setError(SNAPSHOT_HINT);
      return;
    }
    const missing = missingEventRequestFields(
      {
        title,
        sourceUrl,
        sourcePostedAt,
        mediaCount: keptMediaCount,
      },
      { requireSourcePostedAt: false }
    );
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    void saveMutation.run();
  };

  return (
    <PageShell back backFallback={redirectTo} title="Edit request" actions={actions}>
      {/* Under the header, where the trigger that opened it is. */}
      {panels}

      {/* `noValidate`: the shared IncompleteFormNotice owns required-field
          feedback, so the browser's native validation must not preempt it. */}
      <form onSubmit={attemptSave} className="space-y-6" noValidate>
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
          // backend, so a request that arrived flagged cannot be unflagged here.
          graphicLocked={geo.is_graphic}
          detectedFromUrl={geo.detected_from_url}
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

        {/* A request may carry proof images (work started but not finished) or
            stay imageless: the image floor binds at the geolocate. */}
        <ProofEditorPanel
          proof={proof}
          onChange={setProof}
          onProofFilesChange={setProofFiles}
          invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
        />

        {/* Validation + errors sit right above the action: the notice lists
            every missing field at once, the banner carries server failures. */}
        <IncompleteFormNotice
          key={validationAttempt}
          missing={missingFields.map((m) => m.label)}
        />
        {saveMutation.error && (
          <div className={FORM_ERROR_BANNER}>{saveMutation.error}</div>
        )}

        {/* The flow action, alone at the foot of the fields it applies. No
            confirm step: the edit publishes nothing and files no version, which
            is the ordinary way an open request changes. */}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save request"}
        </Button>
      </form>
    </PageShell>
  );
}
