"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { useReviewQueue } from "@/contexts/ReviewQueueContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { apiFetch } from "@/lib/api";
import {
  missingGeolocationFields,
  updateGeolocation,
  validateGeolocation,
  type GeolocationFieldsState,
} from "@/lib/geolocations";
import type { GeolocationDetail, Tag } from "@/types";

/**
 * Owner review + edit of a machine-`detected` geolocation. Built like the submit
 * form (same field bricks, same `MediaManager` staging): the owner curates the
 * whole draft — title, coordinate, source URL, dates, proof (incl. inline
 * images), tags, and source media (new files staged, existing ones marked for
 * removal). Only `detected_from_url` (provenance) is immutable. Everything
 * applies in one atomic multipart `PATCH` on **Save**; **Validate** saves then
 * freezes the row (with a confirm — validation is one-way). State is seeded from
 * props (the form mounts only after the row loaded), so the Tiptap editor gets
 * its `initialContent` on first paint.
 */
export function GeolocationEditForm({
  geo,
  redirectTo,
}: {
  geo: GeolocationDetail;
  redirectTo: string;
}) {
  const router = useRouter();
  const { refresh: refreshReviewCount } = useReviewQueue();

  const [title, setTitle] = useState(geo.title);
  const [lat, setLat] = useState(String(geo.lat));
  const [lng, setLng] = useState(String(geo.lng));
  const [sourceUrl, setSourceUrl] = useState(geo.source_url);
  const [eventDate, setEventDate] = useState(geo.event_date);
  const [sourceDate, setSourceDate] = useState(geo.source_date ?? "");
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

  const [confirmingValidate, setConfirmingValidate] = useState(false);

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
    source_date: sourceDate || undefined,
    proof,
    tag_ids: selectedTagIds,
    remove_media_ids: [...removedIds],
    files: newFiles,
  });

  const saveMutation = useMutation(() => updateGeolocation(geo.id, buildInput()), {
    fallback: "Couldn't save changes.",
    onSuccess: () => {
      refreshReviewCount();
      router.push(redirectTo);
    },
  });

  // Validate saves the staged edits first, then freezes the row — one click.
  const validateMutation = useMutation(
    async () => {
      await updateGeolocation(geo.id, buildInput());
      // PATCH committed (files uploaded / media removed). Clear the staging so
      // that if validate then fails (e.g. a transient error), a retry validates
      // the already-saved row instead of re-uploading the same files.
      setNewFiles([]);
      setRemovedIds(new Set());
      return validateGeolocation(geo.id);
    },
    {
      fallback: "Couldn't validate.",
      onSuccess: () => {
        refreshReviewCount();
        router.push(redirectTo);
      },
    }
  );

  const busy = saveMutation.loading || validateMutation.loading;
  const actionError = saveMutation.error ?? validateMutation.error;

  // Validate floor is computed on the *post-save* state — kept existing media
  // plus staged new files, and the selected curated tags.
  const keptMediaCount =
    geo.media.filter((m) => !removedIds.has(m.id)).length + newFiles.length;
  const selectedCurated = curatedTags.filter((t) => selectedTagIds.includes(t.id));

  const fieldsState = (): GeolocationFieldsState => ({
    title,
    lat,
    lng,
    sourceUrl,
    eventDate,
    proof,
    mediaCount: keptMediaCount,
    hasConflictTag: selectedCurated.some((t) => t.category === "conflict"),
    hasCaptureSourceTag: selectedCurated.some(
      (t) => t.category === "capture_source"
    ),
  });

  // Save persists a partial draft: it needs the core fields valid, but not the
  // full validate floor (source media + tags) — those are enforced at validate.
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.reset();
    validateMutation.reset();
    clearIncomplete();
    const missing = missingGeolocationFields(fieldsState(), {
      requireMedia: false,
      requireTags: false,
    });
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    if (proofImageUploading) {
      saveMutation.setError(
        "An image is still uploading — please wait before saving."
      );
      return;
    }
    saveMutation.run();
  };

  // Validate is one-way, so it enforces the full floor before asking to confirm.
  // Clicking Validate on an incomplete draft surfaces the notice (every miss at
  // once) instead of entering the confirm step.
  const attemptValidate = () => {
    saveMutation.reset();
    validateMutation.reset();
    clearIncomplete();
    // The Conflict / Capture-source taxonomy must be loaded before the floor can
    // tell "didn't pick one" from "options still loading" — otherwise it would
    // spuriously report both tags missing. Recoverable state, not a missing field
    // (mirrors the submit form's guard).
    if (curatedTags.length === 0) {
      validateMutation.setError(
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
      validateMutation.setError(
        "An image is still uploading — please wait before validating."
      );
      return;
    }
    setConfirmingValidate(true);
  };

  const handleValidate = () => {
    validateMutation.run();
  };

  return (
    <PageShell
      back
      title="Review detection"
      subtitle="Review and complete this machine detection, then validate it. Validation publishes the geolocation and freezes it — so give it a full read first."
    >
      {/* `noValidate`: the shared IncompleteFormNotice owns required-field
          feedback, so the browser's native validation must not preempt it. */}
      <form onSubmit={handleSave} className="space-y-6" noValidate>
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
          sourceDate={sourceDate}
          setSourceDate={setSourceDate}
          sourceUrlLocked={false}
          detectedFromUrl={geo.detected_from_url}
          eventDateInvalid={invalidKeys.has("event_date")}
          sourceUrlInvalid={invalidKeys.has("source_url")}
        />

        {curatedTagsError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span>
              Couldn&apos;t load the Conflict and Capture source options.
            </span>
            <button
              type="button"
              onClick={reloadCuratedTags}
              className="shrink-0 font-medium text-orange-400 hover:underline"
            >
              Retry
            </button>
          </div>
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
          <span className="inline-flex items-center gap-1.5">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-md text-sm border border-neutral-700 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {saveMutation.loading ? "Saving…" : "Save changes"}
            </button>
            <FieldHelp concept="action_save_draft" />
          </span>

          {confirmingValidate ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-amber-400/90">
                Once validated it can&apos;t be edited.
              </span>
              <button
                type="button"
                onClick={handleValidate}
                disabled={busy}
                className={`px-4 py-2 rounded-md text-sm disabled:opacity-50 ${PRIMARY_BUTTON}`}
              >
                {validateMutation.loading ? "Validating…" : "Confirm & validate"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingValidate(false)}
                disabled={busy}
                className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={attemptValidate}
                disabled={busy}
                className={`px-4 py-2 rounded-md text-sm disabled:opacity-50 ${PRIMARY_BUTTON}`}
              >
                Validate
              </button>
              <FieldHelp concept="action_validate" />
            </span>
          )}

          <Link
            href={redirectTo}
            className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </PageShell>
  );
}
