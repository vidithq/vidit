"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApiResource } from "@/hooks/useApiResource";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { apiFetch } from "@/lib/api";
import { createBounty, getBounty, missingBountyFields } from "@/lib/bounties";
import { missingGeolocationFields } from "@/lib/geolocations";
import { toDatetimeLocalUTC } from "@/lib/format";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import type { BountyDetail, Tag } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { Archive, ArrowLeft } from "lucide-react";
import { TweetImportBanner } from "@/components/geolocation/TweetImportBanner";
import { TagPicker } from "@/components/ui/TagPicker";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { FILTER_CHIP_ACTIVE, PRIMARY_BUTTON } from "@/components/ui/styles";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { useTweetImport } from "@/components/geolocations/new/useTweetImport";

type SubmitType = "geolocation" | "bounty";

// Inline X logo — lucide ships none, and "Import from a tweet" reads clearer
// with the source platform's mark than a generic import glyph.
function XGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function SubmitPage() {
  // `useSearchParams` opts out of static prerender; Next requires the bailing
  // component under a Suspense boundary. Fallback is minimal — the inner form
  // shows its own "Loading…" once auth resolves.
  return (
    <Suspense
      fallback={
        <PageCenter>
          <span className="text-neutral-500">Loading...</span>
        </PageCenter>
      }
    >
      <SubmitForm />
    </Suspense>
  );
}

function SubmitForm() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bountyIdParam = searchParams.get("bounty_id");

  const [bounty, setBounty] = useState<BountyDetail | null>(null);
  const [bountyError, setBountyError] = useState<string | null>(null);

  // One page, two submission types. Fulfilling a bounty (``?bounty_id=``) is
  // always a geolocation, so the toggle is hidden there; ``?type=bounty`` (the
  // "Post bounty" entry) seeds bounty mode.
  const [submitType, setSubmitType] = useState<SubmitType>(
    !bountyIdParam && searchParams.get("type") === "bounty" ? "bounty" : "geolocation"
  );
  const isBounty = submitType === "bounty";

  // Geolocation sub-mode: the manual form, or the bulk archive on-ramp. Seeded
  // from `?import=1` (the onboarding + /import redirect target).
  const [archiveMode, setArchiveMode] = useState(searchParams.get("import") === "1");
  // Inline "pre-fill from a post" banner, revealed from the import strip.
  const [tweetPrefillOpen, setTweetPrefillOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventDate, setEventDate] = useState("");
  // Optional event time-of-day (HH:MM, UTC).
  const [eventTime, setEventTime] = useState("");
  // When the source posted the media: a datetime-local value (UTC). Required:
  // a post always has a time.
  const [sourcePostedAt, setSourcePostedAt] = useState("");
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  // Separate from the geolocation proof: a bounty's proof is the same idea but
  // in progress (else it'd be a geolocation), optional, and stored on
  // `bounties.proof`. Kept apart so toggling submit type doesn't bleed one
  // draft into the other.
  const [bountyProof, setBountyProof] = useState<Record<string, unknown> | null>(
    null
  );
  const [files, setFiles] = useState<File[]>([]);
  // useState, not useApiResource: TagPicker appends newly created tags
  // via setTags, so the list is server-seeded but locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // Required curated selectors (conflict + capture source) for geolocations.
  // `?curated=true` includes the full taxonomy even for options no live
  // geolocation references yet, else the first analyst to use one couldn't pick
  // it and the required field would be unsatisfiable. A failed load (empty
  // `curatedTags`) surfaces a recoverable `curatedTagsError`.
  const {
    data: curatedTagsData,
    error: curatedTagsError,
    refetch: reloadCuratedTags,
  } = useApiResource<Tag[]>("/tags?curated=true");
  const curatedTags = curatedTagsData ?? [];
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [proofImageUploading, setProofImageUploading] = useState(false);

  // Incomplete-form feedback (shared notice + in-form red outlines).
  const {
    missingFields,
    invalidKeys,
    validationAttempt,
    flagIncomplete,
    clearIncomplete,
  } = useIncompleteForm();

  const {
    importedFrom,
    importGen,
    extraCoordCandidates,
    applyTweetImport,
    clearImportedTweet,
    swapCoordCandidate,
  } = useTweetImport({
    lat,
    lng,
    setTitle,
    setLat,
    setLng,
    setSourceUrl,
    setEventDate,
    setSourcePostedAt,
    setFiles,
    setProof,
  });

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  // Load the bounty being fulfilled to pre-fill + lock inherited fields.
  // On fulfilment the server forces only `source_url` + media from the bounty;
  // the other inherited fields (title, dates, proof, tags) are form-sourced, so
  // this pre-fill is the only carry-over for them. Locking source_url is the UX cue.
  useEffect(() => {
    if (!bountyIdParam) return;
    getBounty(bountyIdParam)
      .then((b) => {
        if (b.status !== "open") {
          setBountyError(
            `This bounty is ${b.status}, so it can't be fulfilled. Open the bounty page instead.`
          );
          return;
        }
        setBounty(b);
        setTitle(b.title);
        setSourceUrl(b.source_url);
        // Carry the bounty's optional metadata into the geolocation form: the
        // dates the poster knew, and the in-progress proof so the analyst
        // continues from it instead of a blank editor. The form mounts only
        // after the bounty loads (Loading guard below), so the proof editor
        // picks `proof` up as its initial content.
        setEventDate(b.event_date ?? "");
        setEventTime(b.event_time?.slice(0, 5) ?? "");
        setSourcePostedAt(toDatetimeLocalUTC(b.source_posted_at));
        setProof(b.proof ?? null);
        setSelectedTagIds(b.tags.map((t) => t.id));
      })
      .catch((err: Error) => setBountyError(err.message));
  }, [bountyIdParam]);

  const lockedFromBounty = bounty !== null;
  // Geolocation-only fields (coordinates, dates, proof) are hidden in bounty
  // mode — a bounty is an unfinished geolocation.
  const showGeoFields = !isBounty;
  // No type toggle while fulfilling a bounty: that path is always a geolocation.
  const showToggle = !bountyIdParam;
  // Import (pre-fill from a post, or bulk archive) is offered only when adding a
  // geolocation and not fulfilling a bounty.
  const canImport = showGeoFields && !lockedFromBounty;

  // Bounty + geolocation are mutually-exclusive submit paths sharing one error
  // banner; each mutation clears the other so the single-slot behaviour holds.
  const bountyMutation = useMutation(
    () =>
      createBounty({
        title: title.trim(),
        source_url: sourceUrl.trim(),
        proof: bountyProof,
        event_date: eventDate || undefined,
        event_time: eventTime || undefined,
        source_posted_at: sourcePostedAt,
        tag_ids: selectedTagIds,
        files,
      }),
    {
      fallback: "Submission failed",
      onSuccess: (created) => router.push(`/bounties/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    () => {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const formData = new FormData();
      formData.append("title", title);
      formData.append("lat", latNum.toString());
      formData.append("lng", lngNum.toString());
      formData.append("source_url", sourceUrl);
      formData.append("event_date", eventDate);
      if (eventTime) {
        formData.append("event_time", eventTime);
      }
      formData.append("source_posted_at", sourcePostedAt);
      formData.append("proof", JSON.stringify(proof));
      if (selectedTagIds.length > 0) {
        formData.append("tag_ids", JSON.stringify(selectedTagIds));
      }
      if (bounty) {
        formData.append("bounty_id", bounty.id);
      }
      for (const file of files) {
        formData.append("files", file);
      }
      return apiFetch<{ id: string }>("/geolocations", {
        method: "POST",
        body: formData,
      });
    },
    {
      fallback: "Submission failed",
      onSuccess: (result) => router.push(`/geolocations/${result.id}`),
    }
  );

  const error = bountyMutation.error ?? geolocationMutation.error;
  const submitting = bountyMutation.loading || geolocationMutation.loading;

  const submitBounty = async () => {
    const missing = missingBountyFields({
      title,
      sourceUrl,
      sourcePostedAt,
      mediaCount: files.length,
    });
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    await bountyMutation.run();
  };

  const submitGeolocation = async () => {
    // The required Conflict / Capture-source options must be loaded before we
    // can tell "didn't pick one" from "couldn't load the choices". A failed or
    // pending load is a recoverable state, not a missing field — surface it in
    // the single-line banner (with Retry above) instead of the field list.
    if (curatedTags.length === 0) {
      geolocationMutation.setError(
        curatedTagsError
          ? "Couldn’t load the required Conflict and Capture source options. Use Retry above, or reload the page."
          : "Still loading the required tag options. Give it a moment and try again."
      );
      return;
    }
    const selectedSet = new Set(selectedTagIds);
    // Mirrors the server submission check, inline so the analyst fixes the whole
    // form in one pass instead of as a 400. When fulfilling a bounty its media
    // transfers in, so staged files aren't required.
    const missing = missingGeolocationFields(
      {
        title,
        lat,
        lng,
        sourceUrl,
        eventDate,
        sourcePostedAt,
        proof,
        mediaCount: files.length,
        hasConflictTag: curatedTags.some(
          (t) => t.category === "conflict" && selectedSet.has(t.id)
        ),
        hasCaptureSourceTag: curatedTags.some(
          (t) => t.category === "capture_source" && selectedSet.has(t.id)
        ),
      },
      { requireMedia: !lockedFromBounty }
    );
    if (missing.length) {
      flagIncomplete(missing);
      return;
    }
    if (proofImageUploading) {
      geolocationMutation.setError(
        "An image is still uploading — please wait before submitting."
      );
      return;
    }
    await geolocationMutation.run();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    bountyMutation.reset();
    geolocationMutation.reset();
    clearIncomplete();
    if (isBounty) {
      await submitBounty();
    } else {
      await submitGeolocation();
    }
  };

  if (authLoading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  // Bounty referenced but couldn't load (404 / wrong status / network).
  if (bountyIdParam && bountyError) {
    return (
      <PageShell title="Geolocate a bounty">
        <div className={FORM_ERROR_BANNER}>{bountyError}</div>
        <Link href="/bounties" className="text-sm text-orange-400 hover:underline">
          ← Back to bounties
        </Link>
      </PageShell>
    );
  }

  // Bounty referenced but still loading — block the form until the
  // title / source / tags are known to pre-fill.
  if (bountyIdParam && !bounty) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading bounty…</span>
      </PageCenter>
    );
  }

  // Header is uniform across both toggle states — the toggle below owns the
  // geolocation-vs-bounty framing. Fulfilment is a distinct entry (no toggle),
  // so it keeps its own title + instructions.
  const pageTitle = lockedFromBounty ? "Geolocate a bounty" : "Submit";
  const subtitle = lockedFromBounty ? (
    <>
      You&apos;re fulfilling a bounty posted by{" "}
      <Link
        href={`/profile/${bounty!.author.username}`}
        className="text-orange-400 hover:underline"
      >
        @{bounty!.author.username}
      </Link>
      . Title, tags, dates, and the proof so far are pre-filled from the bounty;
      refine them. Source and media stay locked (that&apos;s the bounty&apos;s
      evidence). Add the coordinates and finish the proof (cross-referenced
      satellite imagery). When you submit, the bounty is archived as fulfilled
      and the resulting geolocation traces back to it.
    </>
  ) : (
    "Add a geolocation, or post a bounty for footage you couldn't place yet."
  );

  return (
    <PageShell title={pageTitle} subtitle={subtitle}>
      {/* Primary choice: your placed work (Geolocation) vs a request to others
          (Bounty). Hidden in fulfilment, which is always a geolocation. */}
      {showToggle && (
        <div className="inline-flex h-9 items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
          {(["geolocation", "bounty"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setSubmitType(t);
                setArchiveMode(false);
                // Bounty mode has no image upload, so a flag left true by an
                // in-flight geolocation upload would wedge the submit button.
                if (t === "bounty") setProofImageUploading(false);
              }}
              aria-pressed={submitType === t}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                submitType === t
                  ? FILTER_CHIP_ACTIVE
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t === "geolocation" ? "Geolocation" : "Bounty"}
            </button>
          ))}
        </div>
      )}

      {/* Under Geolocation (not fulfilment): two scales of "bring your existing
          X work" — pre-fill one from a post, or bulk-import your archive. The
          manual form stays the default below. */}
      {canImport && !archiveMode && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 px-3 py-2">
          <span className="text-xs text-neutral-500">Already posted it on X?</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTweetPrefillOpen((v) => !v)}
              aria-pressed={tweetPrefillOpen}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:border-orange-500/40 transition-colors"
            >
              <XGlyph size={12} />
              Pre-fill from a post
            </button>
            <button
              type="button"
              onClick={() => setArchiveMode(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:border-orange-500/40 transition-colors"
            >
              <Archive size={13} strokeWidth={1.8} />
              Import your archive
            </button>
          </div>
        </div>
      )}

      {/* Archive on-ramp swaps in for the form; the form stays mounted (hidden)
          so its draft survives a Back. */}
      {canImport && archiveMode && (
        <div className="mt-4 space-y-4">
          <button
            type="button"
            onClick={() => setArchiveMode(false)}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <ArrowLeft size={14} strokeWidth={1.8} />
            Back to the form
          </button>
          <ImportArchivePanel username={user.username} />
        </div>
      )}

      {/* `noValidate`: the shared IncompleteFormNotice owns required-field
          feedback, so the browser's one-bubble-at-a-time native validation must
          not preempt it. */}
      <form
        onSubmit={handleSubmit}
        className={canImport && archiveMode ? "hidden" : "mt-4 space-y-6"}
        noValidate
      >
        {/* Inline pre-fill from a post (the old floating button is gone); stays
            once a tweet is imported so the "Imported from @x" confirmation shows. */}
        {canImport && (tweetPrefillOpen || importedFrom) && (
          <TweetImportBanner
            onImported={applyTweetImport}
            onClear={clearImportedTweet}
            importedFrom={importedFrom}
            linkedX={user?.external_links?.x ?? null}
          />
        )}

        <p className="text-xs text-neutral-500">
          All fields are required unless marked{" "}
          <span className="text-neutral-400">optional</span>.
        </p>

        {/* Title leads, mirroring the detail page where it's the heading. */}
        <TitleField
          value={title}
          onChange={setTitle}
          invalid={invalidKeys.has("title")}
        />

        {/* Source media is its own block; coordinates get the Location block
            (a bounty has no point yet, so Location is geolocation-only). */}
        <SourceMediaField
          existing={bounty ? bounty.media : []}
          locked={lockedFromBounty}
          invalid={invalidKeys.has("source_media")}
          staged={lockedFromBounty ? [] : files}
          onAddFiles={lockedFromBounty ? undefined : (f) => setFiles([...files, ...f])}
          onRemoveStaged={
            lockedFromBounty
              ? undefined
              : (i) => setFiles(files.filter((_, idx) => idx !== i))
          }
        />

        {showGeoFields && (
          <LocationPicker
            lat={lat}
            setLat={setLat}
            lng={lng}
            setLng={setLng}
            extraCoordCandidates={extraCoordCandidates}
            onSwapCandidate={swapCoordCandidate}
            invalid={invalidKeys.has("coordinates")}
          />
        )}

        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          eventDate={eventDate}
          setEventDate={setEventDate}
          eventTime={eventTime}
          setEventTime={setEventTime}
          sourcePostedAt={sourcePostedAt}
          setSourcePostedAt={setSourcePostedAt}
          sourceUrlLocked={lockedFromBounty}
          eventDateRequired={showGeoFields}
          eventDateInvalid={invalidKeys.has("event_date")}
          sourcePostedAtInvalid={invalidKeys.has("source_posted_at")}
          sourceUrlInvalid={invalidKeys.has("source_url")}
        />

        {showGeoFields && curatedTagsError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span>
              Couldn&apos;t load the required Conflict and Capture source options.
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
          requireConflict={showGeoFields}
          requireCaptureSource={showGeoFields}
          conflictInvalid={invalidKeys.has("conflict_tag")}
          captureSourceInvalid={invalidKeys.has("capture_source_tag")}
        />

        {showGeoFields ? (
          <ProofEditorPanel
            key="geo-proof"
            importedFrom={importedFrom}
            importGen={importGen}
            proof={proof}
            onChange={setProof}
            onUploadStateChange={setProofImageUploading}
            invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
          />
        ) : (
          // Same Proof section, harmonised: a bounty's proof is a geolocation
          // proof still in progress (else it'd be a geolocation), so it's
          // optional and image-free — the bounty create path doesn't adopt
          // inline images, which would orphan. Stored as `proof`. The distinct
          // key remounts a fresh, correctly-configured editor on toggle.
          <ProofEditorPanel
            key="bounty-proof"
            importedFrom={null}
            importGen={0}
            proof={bountyProof}
            onChange={setBountyProof}
            allowImages={false}
            optional
          />
        )}

        {showGeoFields && (
          <DuplicateProbe
            lat={lat}
            lng={lng}
            sourceUrl={sourceUrl}
            eventDate={eventDate}
            skip={lockedFromBounty}
          />
        )}

        {/* Validation + errors render next to the button, not atop this long
            form, so a blocked submit is visible without scrolling up. The notice
            lists every missing field at once; the banner carries server / load
            failures. They're mutually exclusive in practice. */}
        <IncompleteFormNotice
          key={validationAttempt}
          missing={missingFields.map((m) => m.label)}
        />
        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting || proofImageUploading}
            className={`px-4 py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
          >
            {isBounty
              ? submitting
                ? "Posting…"
                : "Post bounty"
              : submitting
                ? "Submitting…"
                : proofImageUploading
                  ? "Image uploading…"
                  : lockedFromBounty
                    ? "Submit geolocation (archive bounty)"
                    : "Submit geolocation"}
          </button>
          <Link
            href={isBounty ? "/bounties" : lockedFromBounty ? `/bounties/${bounty!.id}` : "/"}
            className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </PageShell>
  );
}
