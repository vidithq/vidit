"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApiResource } from "@/hooks/useApiResource";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { apiFetch } from "@/lib/api";
// Aliased: a local `submitGeolocation` validation handler below would otherwise
// shadow this API call.
import {
  createEvent,
  createEventRequest,
  getEvent,
  geolocateEvent as geolocateEventApi,
  missingEventFields,
  missingEventRequestFields,
  parseCaptureCoords,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import type { EventDetail, Tag } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Archive, ArrowLeft } from "lucide-react";
import { TweetImportBanner } from "@/components/event/TweetImportBanner";
import { TagPicker } from "@/components/ui/TagPicker";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { TEXT_LINK } from "@/components/ui/styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button, buttonClasses } from "@/components/ui/Button";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
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
    <Suspense fallback={<PageLoading />}>
      <SubmitForm />
    </Suspense>
  );
}

function SubmitForm() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bountyIdParam = searchParams.get("bounty_id");

  const [bounty, setBounty] = useState<EventDetail | null>(null);
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
  // Optional camera position (where the footage was shot from), distinct from
  // the subject lat/lng. Both-or-neither is enforced at submit.
  const [captureLat, setCaptureLat] = useState("");
  const [captureLng, setCaptureLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventDate, setEventDate] = useState("");
  // Optional event time-of-day (HH:MM, UTC).
  const [eventTime, setEventTime] = useState("");
  // When the source posted the media: a datetime-local value (UTC). Required:
  // a post always has a time.
  const [sourcePostedAt, setSourcePostedAt] = useState("");
  const [proof, setProof] = useState<Record<string, unknown> | null>(null);
  // The proof body's inline images, held locally by the editor and uploaded as
  // `proof_files[]` only at publish (nothing hits S3 while typing). The editor
  // reports the still-referenced set on every edit.
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  // Separate from the geolocation proof: a bounty's proof is the same idea but
  // in progress (else it'd be a geolocation), optional, and stored on
  // `bounties.proof`. Kept apart so toggling submit type doesn't bleed one
  // draft into the other. (Image-free, so no proof_files companion.)
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
    getEvent(bountyIdParam)
      .then((b) => {
        if (b.status !== "requested") {
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
    () => {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const hasGuess = !isNaN(latNum) && !isNaN(lngNum);
      return createEventRequest({
        title: title.trim(),
        source_url: sourceUrl.trim(),
        proof: bountyProof,
        lat: hasGuess ? latNum : undefined,
        lng: hasGuess ? lngNum : undefined,
        ...parseCaptureCoords(captureLat, captureLng),
        event_date: eventDate || undefined,
        event_time: eventTime || undefined,
        source_posted_at: sourcePostedAt,
        tag_ids: selectedTagIds,
        files,
      });
    },
    {
      fallback: "Submission failed",
      onSuccess: (created) => router.push(`/bounties/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    (): Promise<{ id: string }> => {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const capture = parseCaptureCoords(captureLat, captureLng);
      // Fulfilling a request is a lifecycle move on that same event: geolocate
      // (``requested`` → ``geolocated``) transfers ownership to the fulfiller.
      // Its source media is already on the row, so no source files are staged /
      // removed here; the fulfiller's proof images still upload at publish.
      if (bounty) {
        return geolocateEventApi(bounty.id, {
          title,
          lat: latNum,
          lng: lngNum,
          ...capture,
          source_url: sourceUrl,
          event_date: eventDate,
          event_time: eventTime || undefined,
          source_posted_at: sourcePostedAt,
          proof,
          tag_ids: selectedTagIds,
          remove_media_ids: [],
          files: [],
          proof_files: proofFiles,
        });
      }
      return createEvent({
        title,
        lat: latNum,
        lng: lngNum,
        ...capture,
        source_url: sourceUrl,
        event_date: eventDate,
        event_time: eventTime || undefined,
        source_posted_at: sourcePostedAt,
        proof,
        tag_ids: selectedTagIds,
        files,
        proof_files: proofFiles,
      });
    },
    {
      fallback: "Submission failed",
      onSuccess: (result) => router.push(`/events/${result.id}`),
    }
  );

  const error = bountyMutation.error ?? geolocationMutation.error;
  const submitting = bountyMutation.loading || geolocationMutation.loading;

  const submitBounty = async () => {
    const missing = missingEventRequestFields({
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
    const missing = missingEventFields(
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
    return <PageLoading />;
  }

  // Bounty referenced but couldn't load (404 / wrong status / network).
  if (bountyIdParam && bountyError) {
    return (
      <PageShell title="Geolocate a bounty">
        <div className={FORM_ERROR_BANNER}>{bountyError}</div>
        <Link href="/bounties" className={`text-sm ${TEXT_LINK}`}>
          ← Back to bounties
        </Link>
      </PageShell>
    );
  }

  // Bounty referenced but still loading — block the form until the
  // title / source / tags are known to pre-fill.
  if (bountyIdParam && !bounty) {
    return <PageLoading label="Loading bounty…" />;
  }

  // Header is uniform across both toggle states — the toggle below owns the
  // geolocation-vs-bounty framing. Fulfilment is a distinct entry (no toggle),
  // so it keeps its own title + instructions.
  const pageTitle = lockedFromBounty ? "Geolocate a bounty" : "Submit";
  const subtitle = lockedFromBounty ? (
    <>
      You&apos;re fulfilling a bounty posted by{" "}
      <Link
        href={`/profile/${bounty!.owner.username}`}
        className={TEXT_LINK}
      >
        @{bounty!.owner.username}
      </Link>
      . Title, tags, dates, and the proof so far are pre-filled from the bounty;
      refine them. Source and media stay locked (that&apos;s the bounty&apos;s
      evidence). Add the coordinates and finish the proof (cross-referenced
      satellite imagery). When you submit, this request becomes a geolocation and
      keeps a note of who requested it.
    </>
  ) : (
    "Add a geolocation, or post a bounty for footage you couldn't place yet."
  );

  return (
    <PageShell title={pageTitle} subtitle={subtitle}>
      {/* Primary choice: your placed work (Geolocation) vs a request to others
          (Bounty). Hidden in fulfilment, which is always a geolocation. */}
      {showToggle && (
        <SegmentedControl
          aria-label="Submission type"
          options={[
            { value: "geolocation", label: "Geolocation" },
            { value: "bounty", label: "Bounty" },
          ]}
          value={submitType}
          onChange={(t) => {
            setSubmitType(t);
            setArchiveMode(false);
          }}
        />
      )}

      {/* Under Geolocation (not fulfilment): two scales of "bring your existing
          X work": pre-fill one from a post, or bulk-import your archive. The
          manual form stays the default below. */}
      {canImport && !archiveMode && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setTweetPrefillOpen((v) => !v)}
            aria-pressed={tweetPrefillOpen}
          >
            <XGlyph size={12} />
            Pre-fill from an X post
          </Button>
          <Button variant="secondary" onClick={() => setArchiveMode(true)}>
            <Archive size={13} strokeWidth={1.8} />
            Import your X archive
          </Button>
        </div>
      )}

      {/* Archive on-ramp swaps in for the form; the form stays mounted (hidden)
          so its draft survives a Back. */}
      {canImport && archiveMode && (
        <div className="mt-4 space-y-4">
          <Button variant="ghost" onClick={() => setArchiveMode(false)}>
            <ArrowLeft size={14} strokeWidth={1.8} />
            Back to the form
          </Button>
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
            onImported={(parsed) => {
              // The editor remounts on import (its key changes); its inline
              // images are real URLs, so drop any locally-staged proof files so
              // the staged set matches the freshly-mounted doc.
              setProofFiles([]);
              applyTweetImport(parsed);
            }}
            onClear={() => {
              setProofFiles([]);
              clearImportedTweet();
            }}
            importedFrom={importedFrom}
            linkedX={user?.external_links?.x ?? null}
          />
        )}

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
            captureLat={captureLat}
            setCaptureLat={setCaptureLat}
            captureLng={captureLng}
            setCaptureLng={setCaptureLng}
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
          <CuratedTagsError onRetry={reloadCuratedTags} />
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
            onProofFilesChange={setProofFiles}
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
          <Button type="submit" variant="primary" disabled={submitting}>
            {isBounty
              ? submitting
                ? "Posting…"
                : "Post bounty"
              : submitting
                ? "Submitting…"
                : lockedFromBounty
                  ? "Submit geolocation (fulfil request)"
                  : "Submit geolocation"}
          </Button>
          <Link
            href={isBounty ? "/bounties" : lockedFromBounty ? `/bounties/${bounty!.id}` : "/"}
            className={buttonClasses("ghost")}
          >
            Cancel
          </Link>
        </div>
      </form>
    </PageShell>
  );
}
