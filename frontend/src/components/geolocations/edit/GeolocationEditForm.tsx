"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";

import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { PageShell } from "@/components/ui/PageShell";
import { TagPicker } from "@/components/ui/TagPicker";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import FieldHelp from "@/components/ui/FieldHelp";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { apiFetch } from "@/lib/api";
import {
  missingGeolocationFields,
  rejectGeolocation,
  submitGeolocation,
  type GeolocationFieldsState,
} from "@/lib/geolocations";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { toDatetimeLocalUTC } from "@/lib/format";
import type { GeolocationDetail, Tag } from "@/types";

/**
 * Owner edit + submit of a machine-`detected` geolocation. Built like the create
 * form (same field bricks, same `MediaManager` staging): the owner curates the
 * whole detection (title, coordinate, source URL, dates, proof including inline
 * images, tags, and source media, with new files staged and existing ones marked
 * for removal). Only `detected_from_url` (provenance) is immutable. A `detected`
 * row is immutable machine output; **Submit** is the only write, applying the
 * whole form and flipping the row to `submitted` in one atomic multipart request
 * (with a confirm, since submitting freezes it). State is seeded from props (the
 * form mounts only after the row loaded), so the Tiptap editor gets its
 * `initialContent` on first paint.
 */
export function GeolocationEditForm({
  geo,
  redirectTo,
}: {
  geo: GeolocationDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();

  const [title, setTitle] = useState(geo.title);
  const [lat, setLat] = useState(String(geo.lat));
  const [lng, setLng] = useState(String(geo.lng));
  const [sourceUrl, setSourceUrl] = useState(geo.source_url);
  const [eventDate, setEventDate] = useState(geo.event_date);
  const [eventTime, setEventTime] = useState(geo.event_time?.slice(0, 5) ?? "");
  const [sourcePostedAt, setSourcePostedAt] = useState(
    toDatetimeLocalUTC(geo.source_posted_at)
  );
  const [proof, setProof] = useState<Record<string, unknown> | null>(geo.proof);
  const [proofImageUploading, setProofImageUploading] = useState(false);

  // Media is staged (applied on save), like submit: existing rows can be marked
  // for removal, new files queued for upload.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const [tags, setTags] = useState<Tag[]>([]);
  const { data: curatedTagsData, error: curatedTagsError, refetch: reloadCuratedTags } =
    useApiResource<Tag[]>("/tags?curated=true");
  const curatedTags = curatedTagsData ?? [];
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    geo.tags.map((t) => t.id)
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

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  const buildInput = () => ({
    title: title.trim(),
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    source_url: sourceUrl.trim(),
    event_date: eventDate,
    event_time: eventTime || undefined,
    source_posted_at: sourcePostedAt,
    proof,
    tag_ids: selectedTagIds,
    remove_media_ids: [...removedIds],
    files: newFiles,
  });

  // Submit is the only write to a detection: it applies the whole form and flips
  // the row to `submitted` in one atomic request (the server enforces the floor
  // too). A `detected` row is otherwise immutable machine output.
  const submitMutation = useMutation(() => submitGeolocation(geo.id, buildInput()), {
    fallback: "Couldn't submit.",
    onSuccess: () => {
      refreshDetectionCount();
      router.push(redirectTo);
    },
  });

  // Reject (soft-delete) the detection — the queue's old inline delete moved
  // here so a detection card is just a click, like every other card.
  const rejectMutation = useMutation(() => rejectGeolocation(geo.id), {
    fallback: "Couldn't reject this detection.",
    onSuccess: () => {
      refreshDetectionCount();
      router.push(redirectTo);
    },
  });
  const confirmReject = useConfirmAction(() => rejectMutation.run());

  const busy = submitMutation.loading || rejectMutation.loading;
  const actionError = submitMutation.error ?? rejectMutation.error;

  // Submit floor is computed on the post-edit state: kept existing media plus
  // staged new files, and the selected curated tags.
  const keptMediaCount =
    geo.media.filter((m) => !removedIds.has(m.id)).length + newFiles.length;
  const selectedCurated = curatedTags.filter((t) => selectedTagIds.includes(t.id));

  const fieldsState = (): GeolocationFieldsState => ({
    title,
    lat,
    lng,
    sourceUrl,
    eventDate,
    sourcePostedAt,
    proof,
    mediaCount: keptMediaCount,
    hasConflictTag: selectedCurated.some((t) => t.category === "conflict"),
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
    // spuriously report both tags missing. Recoverable state, not a missing field
    // (mirrors the create form's guard).
    if (curatedTags.length === 0) {
      submitMutation.setError(
        curatedTagsError
          ? "Couldn’t load the Conflict and Capture source options. Use Retry above, or reload the page."
          : "Still loading the required tag options. Give it a moment and try again."
      );
      return;
    }
    const missing = missingGeolocationFields(fieldsState(), {
      requireMedia: true,
      requireTags: true,
    });
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    if (proofImageUploading) {
      submitMutation.setError(
        "An image is still uploading, please wait before submitting."
      );
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
    >
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
          extraCoordCandidates={[]}
          onSwapCandidate={() => {}}
          invalid={invalidKeys.has("coordinates")}
        />

        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          eventDate={eventDate}
          setEventDate={setEventDate}
          eventTime={eventTime}
          setEventTime={setEventTime}
          sourcePostedAt={sourcePostedAt}
          setSourcePostedAt={setSourcePostedAt}
          sourceUrlLocked={false}
          detectedFromUrl={geo.detected_from_url}
          eventDateInvalid={invalidKeys.has("event_date")}
          sourcePostedAtInvalid={invalidKeys.has("source_posted_at")}
          sourceUrlInvalid={invalidKeys.has("source_url")}
        />

        {curatedTagsError && (
          <CuratedTagsError
            onRetry={reloadCuratedTags}
            message="Couldn't load the Conflict and Capture source options."
          />
        )}
        <TagPicker
          tags={tags}
          setTags={setTags}
          curatedTags={curatedTags}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
          requireConflict
          requireCaptureSource
          conflictInvalid={invalidKeys.has("conflict_tag")}
          captureSourceInvalid={invalidKeys.has("capture_source_tag")}
        />

        <ProofEditorPanel
          importedFrom={null}
          importGen={0}
          proof={proof}
          onChange={setProof}
          onUploadStateChange={setProofImageUploading}
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

          {/* Reject (soft-delete) lives here now, not on the queue card. */}
          {confirmReject.armed ? (
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Button
                variant="danger"
                onClick={confirmReject.trigger}
                disabled={busy}
                className={DANGER_CONFIRM}
              >
                {rejectMutation.loading ? "Rejecting…" : "Confirm reject"}
              </Button>
              <Button
                variant="ghost"
                icon
                onClick={confirmReject.cancel}
                disabled={busy}
                aria-label="Cancel reject"
              >
                <X size={13} />
              </Button>
            </span>
          ) : (
            <Button
              variant="danger"
              onClick={confirmReject.trigger}
              disabled={busy}
              className="ml-auto"
            >
              Reject detection
            </Button>
          )}
        </div>
      </form>
    </PageShell>
  );
}
