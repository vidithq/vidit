"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApiResource } from "@/hooks/useApiResource";
import { useIncompleteForm } from "@/hooks/useIncompleteForm";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { apiFetch } from "@/lib/api";
import {
  cleanNumber,
  createEvent,
  createEventRequest,
  FIELD_LABELS,
  getEvent,
  geolocateEvent as geolocateEventApi,
  missingEventFields,
  missingEventRequestFields,
  parseCaptureCoords,
  parseGuessCoords,
  type MissingFieldKey,
} from "@/lib/events";
import { toDatetimeLocalUTC } from "@/lib/format";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import type { EventDetail, Tag } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { TweetImportBanner } from "@/components/event/TweetImportBanner";
import { TagPicker } from "@/components/ui/TagPicker";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { Archive, Check, Circle, MapPin, Megaphone } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { DetailsFields } from "@/components/geolocations/new/DetailsFields";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { LocationPicker } from "@/components/geolocations/new/LocationPicker";
import { SourceMediaField } from "@/components/geolocations/SourceMediaField";
import { TitleField } from "@/components/geolocations/TitleField";
import { ProofEditorPanel } from "@/components/geolocations/new/ProofEditorPanel";
import { useTweetImport } from "@/components/geolocations/new/useTweetImport";

// Two submission modes, picked at the top. `single` is one event by hand,
// optionally pre-filled from an X post; `bulk` is the archive on-ramp that
// backfills many. There is no geolocation vs request pick: the analyst fills what
// they have and the two publish actions unlock from the content (a placed
// coordinate plus evidence publishes a geolocation, the bare footage posts a
// request for others to locate).
type Mode = "single" | "bulk";

// A publish-floor requirement, shown as a tick in the readiness list. `keys` are
// the `missingEvent*` field keys it covers (proof needs two, "no proof" vs
// "text only"), so met state derives from the live missing set and the validator
// stays the one source of truth. `inheritedOnFulfil` marks a floor the fulfiller
// doesn't re-supply because the request already carries it (its media), so it
// drops out of the fulfilment checklist.
type Req = { label: string; keys: MissingFieldKey[]; inheritedOnFulfil?: boolean };

// The request floor: enough to be actionable by someone else. A subset of the
// geolocation floor, shown first so the escalation reads top to bottom.
const REQUEST_REQS: Req[] = [
  { label: FIELD_LABELS.title, keys: ["title"] },
  { label: FIELD_LABELS.source_media, keys: ["source_media"], inheritedOnFulfil: true },
  { label: FIELD_LABELS.source_url, keys: ["source_url"] },
  { label: FIELD_LABELS.source_posted_at, keys: ["source_posted_at"] },
];

// What a full geolocation adds on top of the request floor.
const GEO_EXTRA_REQS: Req[] = [
  { label: FIELD_LABELS.coordinates, keys: ["coordinates"] },
  { label: FIELD_LABELS.event_date, keys: ["event_date"] },
  { label: FIELD_LABELS.proof_image, keys: ["proof", "proof_image"] },
  { label: FIELD_LABELS.conflict_tag, keys: ["conflict_tag"] },
  { label: FIELD_LABELS.capture_source_tag, keys: ["capture_source_tag"] },
];

// Inline X logo: lucide ships none, and "from an X post" reads clearer with the
// source platform's mark than a generic import glyph.
function XGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// The readiness tick-list: one Pill per requirement, a check once met and a
// hollow ring while pending. Met reads as the `secondary` (outline) tone,
// pending as `neutral`. Reuses the Pill primitive (static span, no onClick) so
// it can't be mistaken for a selectable chip.
function ReqChecklist({
  reqs,
  missing,
}: {
  reqs: Req[];
  missing: Set<MissingFieldKey>;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {reqs.map((r) => {
        const met = r.keys.every((k) => !missing.has(k));
        return (
          <li key={r.label}>
            <Pill
              tone={met ? "secondary" : "neutral"}
              icon={
                met ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <Circle size={9} strokeWidth={2} />
                )
              }
            >
              {r.label}
            </Pill>
          </li>
        );
      })}
    </ul>
  );
}

export default function SubmitPage() {
  // `useSearchParams` opts out of static prerender; Next requires the bailing
  // component under a Suspense boundary. Fallback is minimal: the inner form
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
  const requestIdParam = searchParams.get("request_id");

  const [request, setRequest] = useState<EventDetail | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Single vs bulk. Seeded to the archive on-ramp from `?import=1` (the
  // onboarding + /import redirect target); otherwise the single-event form.
  const [mode, setMode] = useState<Mode>(
    searchParams.get("import") === "1" ? "bulk" : "single"
  );
  // The inline "pre-fill from an X post" affordance, revealed inside single mode.
  const [tweetPrefillOpen, setTweetPrefillOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  // Optional camera position (where the footage was shot from), distinct from
  // the subject lat/lng. Both-or-neither is enforced at publish.
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
  // `proof_files[]` at publish (nothing hits S3 while typing). Both publish
  // paths carry them: a geolocation requires an image, a request may attach them
  // (work started but not finished) or stay imageless.
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  // useState, not useApiResource: TagPicker appends newly created tags
  // via setTags, so the list is server-seeded but locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // Curated selectors (conflict + capture source). Required only to publish a
  // geolocation, so the field itself is optional; the readiness list names them
  // as part of the geolocation floor. `?curated=true` includes the full taxonomy
  // even for options no live geolocation references yet, else the first analyst
  // to use one couldn't pick it. A failed load surfaces a recoverable error.
  const {
    data: curatedTagsData,
    error: curatedTagsError,
    refetch: reloadCuratedTags,
  } = useApiResource<Tag[]>("/tags?curated=true");
  // Stable reference (the `?? []` fallback would otherwise mint a new array each
  // render), so the readiness memos below don't recompute on unrelated renders.
  const curatedTags = useMemo(() => curatedTagsData ?? [], [curatedTagsData]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // In-form red outlines: set when a publish action is clicked while its floor
  // is short, so the analyst sees which fields to fix (the tick-list says what,
  // the outline says where). The single notice banner isn't rendered here; the
  // tick-list is the standing summary.
  const { invalidKeys, flagIncomplete, clearIncomplete } = useIncompleteForm();

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

  // Load the request being fulfilled to pre-fill + lock inherited fields.
  // On fulfilment the server forces only `source_url` + media from the request;
  // the other inherited fields (title, dates, proof, tags) are form-sourced, so
  // this pre-fill is the only carry-over for them. Locking source_url is the UX cue.
  useEffect(() => {
    if (!requestIdParam) return;
    getEvent(requestIdParam)
      .then((b) => {
        if (b.status !== "requested") {
          setRequestError(
            `This request is ${b.status}, so it can't be fulfilled. Open the request page instead.`
          );
          return;
        }
        setRequest(b);
        setTitle(b.title);
        // A ``requested`` row always carries a source_url (the backend CHECK
        // ties it to status); the `?? ""` only satisfies the nullable wire
        // type, it never actually falls back here.
        setSourceUrl(b.source_url ?? "");
        // Carry the request's optional metadata into the form: the dates the
        // poster knew, and the in-progress proof so the analyst continues from
        // it instead of a blank editor. The form mounts only after the request
        // loads (Loading guard below), so the proof editor picks `proof` up as
        // its initial content.
        setEventDate(b.event_date ?? "");
        setEventTime(b.event_time?.slice(0, 5) ?? "");
        setSourcePostedAt(toDatetimeLocalUTC(b.source_posted_at));
        setProof(b.proof ?? null);
        setSelectedTagIds(b.tags.map((t) => t.id));
      })
      .catch((err: Error) => setRequestError(err.message));
  }, [requestIdParam]);

  const lockedFromRequest = request !== null;
  // Import (post pre-fill or bulk archive) is offered only on a fresh create,
  // not while fulfilling someone else's request.
  const canImport = !lockedFromRequest;

  // The two publish paths share one error banner; each mutation clears the other
  // so the single-slot behaviour holds.
  const requestMutation = useMutation(
    () =>
      createEventRequest({
        title: title.trim(),
        source_url: sourceUrl.trim(),
        proof,
        // Optional approximate guess, both-or-neither, same strict parse as the
        // camera point below (no silent truncation of a half-typed coordinate).
        ...parseGuessCoords(lat, lng),
        ...parseCaptureCoords(captureLat, captureLng),
        event_date: eventDate || undefined,
        event_time: eventTime || undefined,
        source_posted_at: sourcePostedAt,
        tag_ids: selectedTagIds,
        files,
        proof_files: proofFiles,
      }),
    {
      fallback: "Submission failed",
      onSuccess: (created) => router.push(`/requests/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    (): Promise<{ id: string }> => {
      // Required here (gated by `geoReady`), parsed strictly like the camera
      // point so the same coordinate can't read valid one way and invalid the
      // other; the gate keeps a NaN from ever reaching a publish.
      const latNum = cleanNumber(lat) ?? NaN;
      const lngNum = cleanNumber(lng) ?? NaN;
      const capture = parseCaptureCoords(captureLat, captureLng);
      // Fulfilling a request is a lifecycle move on that same event: geolocate
      // (``requested`` to ``geolocated``) transfers ownership to the fulfiller.
      // Its source media is already on the row, so no source files are staged /
      // removed here; the fulfiller's proof images still upload at publish.
      if (request) {
        return geolocateEventApi(request.id, {
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

  const error = requestMutation.error ?? geolocationMutation.error;
  const submitting = requestMutation.loading || geolocationMutation.loading;

  // Live readiness for the two actions, straight from the shared validators.
  // Media is supplied by the request on a fulfilment, so it isn't required there.
  // Memoised so the field scans (incl. the curated-tag `.some()` passes) only
  // recompute when an input they read changes, not on every unrelated render.
  const geoMissing = useMemo(
    () =>
      missingEventFields(
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
            (t) => t.category === "conflict" && selectedTagIds.includes(t.id)
          ),
          hasCaptureSourceTag: curatedTags.some(
            (t) => t.category === "capture_source" && selectedTagIds.includes(t.id)
          ),
        },
        { requireMedia: !lockedFromRequest }
      ),
    [
      title,
      lat,
      lng,
      sourceUrl,
      eventDate,
      sourcePostedAt,
      proof,
      files.length,
      curatedTags,
      selectedTagIds,
      lockedFromRequest,
    ]
  );
  const reqMissing = useMemo(
    () =>
      missingEventRequestFields({
        title,
        sourceUrl,
        sourcePostedAt,
        mediaCount: files.length,
      }),
    [title, sourceUrl, sourcePostedAt, files.length]
  );
  const geoMissingKeys = useMemo(
    () => new Set<MissingFieldKey>(geoMissing.map((m) => m.key)),
    [geoMissing]
  );
  const reqMissingKeys = useMemo(
    () => new Set<MissingFieldKey>(reqMissing.map((m) => m.key)),
    [reqMissing]
  );
  // Readiness drives the button emphasis: full strength when the floor is met,
  // dimmed while short. The button stays clickable so a click still flags the
  // gaps red; the dim is the at-a-glance "not ready yet" cue.
  const geoReady = geoMissing.length === 0 && curatedTags.length > 0;
  const reqReady = reqMissing.length === 0;

  // Both publish handlers clear the shared error banner (the two mutations share
  // one slot) and any prior red outlines before re-validating.
  const resetActions = () => {
    requestMutation.reset();
    geolocationMutation.reset();
    clearIncomplete();
  };

  const publishGeolocation = async () => {
    resetActions();
    // A pending / failed curated-tags load is a recoverable state, not a missing
    // field: surface it in the banner (Retry lives above) instead of the outlines.
    if (curatedTags.length === 0) {
      geolocationMutation.setError(
        curatedTagsError
          ? "Couldn’t load the required Conflict and Capture source options. Use Retry above, or reload the page."
          : "Still loading the required tag options. Give it a moment and try again."
      );
      return;
    }
    if (geoMissing.length) {
      flagIncomplete(geoMissing);
      return;
    }
    await geolocationMutation.run();
  };

  const postRequest = async () => {
    resetActions();
    if (reqMissing.length) {
      flagIncomplete(reqMissing);
      return;
    }
    await requestMutation.run();
  };

  if (authLoading || !user) {
    return <PageLoading />;
  }

  // Request referenced but couldn't load (404 / wrong status / network).
  if (requestIdParam && requestError) {
    return (
      <PageShell title="Geolocate a request">
        <div className={FORM_ERROR_BANNER}>{requestError}</div>
        <Link href="/requests" className={`text-sm ${TEXT_LINK}`}>
          ← Back to requests
        </Link>
      </PageShell>
    );
  }

  // Request referenced but still loading: block the form until the
  // title / source / tags are known to pre-fill.
  if (requestIdParam && !request) {
    return <PageLoading label="Loading request…" />;
  }

  // Fulfilment is a distinct entry: it keeps its own title + instructions and
  // publishes only a geolocation. A fresh submit gets the neutral framing (fill
  // what you have, then publish a geolocation or a request).
  const pageTitle = lockedFromRequest ? "Geolocate a request" : "Submit";
  const subtitle = lockedFromRequest ? (
    <>
      You&apos;re fulfilling a request posted by{" "}
      <Link
        href={`/profile/${request!.owner.username}`}
        className={TEXT_LINK}
      >
        @{request!.owner.username}
      </Link>
      . Title, tags, dates, and the proof so far are pre-filled from the request;
      refine them. Source and media stay locked (that&apos;s the request&apos;s
      evidence). Add the coordinates and finish the proof (cross-referenced
      satellite imagery). When you submit, this request becomes a geolocation and
      keeps a note of who requested it.
    </>
  ) : (
    "Fill in what you have. Publish it as a geolocation once you've placed it, or as a request for others to locate."
  );

  const showBulk = canImport && mode === "bulk";
  // On a fulfilment, media is supplied by the request, so it drops out of the
  // geolocation floor shown to the fulfiller.
  const geoFulfilReqs = [
    ...REQUEST_REQS.filter((r) => !r.inheritedOnFulfil),
    ...GEO_EXTRA_REQS,
  ];

  return (
    <PageShell title={pageTitle} subtitle={subtitle}>
      {/* Single vs bulk (fresh create only). Single hosts the one-event form
          plus the optional X-post pre-fill; bulk is the archive on-ramp. */}
      {canImport && (
        <div className="mt-4">
          <SegmentedControl
            aria-label="Submission mode"
            options={[
              { value: "single", label: "Single" },
              {
                value: "bulk",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Archive size={13} strokeWidth={1.8} />
                    Bulk import
                  </span>
                ),
              },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      )}

      {/* Archive on-ramp swaps in for the form; the form stays mounted (hidden)
          so its draft survives switching back. */}
      {showBulk && (
        <div className="mt-4">
          <ImportArchivePanel username={user.username} />
        </div>
      )}

      {/* No `onSubmit` route: the publish actions are explicit buttons. Clicking
          one while its floor is short flags the missing fields red instead of
          posting. `noValidate` keeps the browser's native bubbles from firing. */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className={showBulk ? "hidden" : "mt-4 space-y-6"}
        noValidate
      >
        {/* Single mode carries a "pre-fill from an X post" affordance; the banner
            stays once a post is imported so the "Imported from @x" confirmation
            shows. */}
        {canImport && mode === "single" && (
          <div>
            <Button
              variant="secondary"
              onClick={() => setTweetPrefillOpen((v) => !v)}
              aria-pressed={tweetPrefillOpen}
            >
              <XGlyph size={12} />
              Pre-fill from an X post
            </Button>
          </div>
        )}
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

        {/* Source media is its own block; the subject coordinate gets the
            Location block below. */}
        <SourceMediaField
          existing={request ? request.media : []}
          locked={lockedFromRequest}
          invalid={invalidKeys.has("source_media")}
          staged={lockedFromRequest ? [] : files}
          onAddFiles={lockedFromRequest ? undefined : (f) => setFiles([...files, ...f])}
          onRemoveStaged={
            lockedFromRequest
              ? undefined
              : (i) => setFiles(files.filter((_, idx) => idx !== i))
          }
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
          extraCoordCandidates={extraCoordCandidates}
          onSwapCandidate={swapCoordCandidate}
          invalid={invalidKeys.has("coordinates")}
        />

        {/* Event date is required only to publish a geolocation, so it's
            optional at the field level; the readiness list names it as part of
            the geolocation floor. */}
        <DetailsFields
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          eventDate={eventDate}
          setEventDate={setEventDate}
          eventTime={eventTime}
          setEventTime={setEventTime}
          sourcePostedAt={sourcePostedAt}
          setSourcePostedAt={setSourcePostedAt}
          sourceUrlLocked={lockedFromRequest}
          eventDateRequired={false}
          eventDateInvalid={invalidKeys.has("event_date")}
          sourcePostedAtInvalid={invalidKeys.has("source_posted_at")}
          sourceUrlInvalid={invalidKeys.has("source_url")}
        />

        {curatedTagsError && <CuratedTagsError onRetry={reloadCuratedTags} />}
        <TagPicker
          tags={tags}
          setTags={setTags}
          curatedTags={curatedTags}
          selectedTagIds={selectedTagIds}
          setSelectedTagIds={setSelectedTagIds}
          requireConflict={false}
          requireCaptureSource={false}
          conflictInvalid={invalidKeys.has("conflict_tag")}
          captureSourceInvalid={invalidKeys.has("capture_source_tag")}
        />

        {/* One proof editor, images allowed. Optional at the field level: a
            geolocation needs an image (named in the readiness list); a request
            may attach images (work in progress) or stay imageless. */}
        <ProofEditorPanel
          importedFrom={importedFrom}
          importGen={importGen}
          proof={proof}
          onChange={setProof}
          onProofFilesChange={setProofFiles}
          optional
          invalid={invalidKeys.has("proof") || invalidKeys.has("proof_image")}
        />

        <DuplicateProbe
          lat={lat}
          lng={lng}
          sourceUrl={sourceUrl}
          eventDate={eventDate}
          skip={lockedFromRequest}
        />

        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}

        {lockedFromRequest ? (
          // Fulfilment can only become a geolocation: one action, no request path.
          <div className="space-y-3">
            <ReqChecklist reqs={geoFulfilReqs} missing={geoMissingKeys} />
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              className={geoReady ? "" : "opacity-60"}
              onClick={publishGeolocation}
            >
              <MapPin size={14} strokeWidth={2} />
              {geolocationMutation.loading
                ? "Publishing…"
                : "Publish geolocation (fulfil request)"}
            </Button>
          </div>
        ) : (
          // Two outcomes gated on the content. The readiness list escalates: meet
          // the request floor and a request can post; add the extra rows and a full
          // geolocation can publish. Clicking an action while short flags the
          // gaps red rather than posting.
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-neutral-400">
                To post a request for others to locate, add:
              </p>
              <ReqChecklist reqs={REQUEST_REQS} missing={reqMissingKeys} />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-neutral-400">
                Plus, to publish it as a full geolocation:
              </p>
              <ReqChecklist reqs={GEO_EXTRA_REQS} missing={geoMissingKeys} />
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                className={geoReady ? "" : "opacity-60"}
                onClick={publishGeolocation}
              >
                <MapPin size={14} strokeWidth={2} />
                {geolocationMutation.loading ? "Publishing…" : "Publish geolocation"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                className={reqReady ? "" : "opacity-60"}
                onClick={postRequest}
              >
                <Megaphone size={14} strokeWidth={2} />
                {requestMutation.loading ? "Posting…" : "Publish request"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </PageShell>
  );
}
