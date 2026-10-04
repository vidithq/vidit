"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cleanNumber } from "@/lib/coordinates";
import {
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
import type { EventDetail } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel } from "@/components/geolocations/ImportPostPanel";
import { Archive, Check, Circle, MapPin, Megaphone } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import {
  EventFormFields,
  useEventForm,
} from "@/components/geolocations/EventFormFields";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";

// Three entry paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. There is no geolocation-vs-request pick: the two publish actions unlock from the
// content (a placed coordinate plus evidence publishes a geolocation, bare footage posts a
// request).
type Mode = "single" | "xpost" | "bulk";

// A publish-floor requirement shown as a tick. `keys` are the `missingEvent*` field keys it
// covers (proof needs two), so met state derives from the live missing set and the validator
// stays the one source of truth. `inheritedOnFulfil` marks a floor the request already
// carries (its media), dropped from the fulfilment checklist.
type Req = { label: string; keys: MissingFieldKey[]; inheritedOnFulfil?: boolean };

// The request floor: enough to be actionable by someone else, a subset of the geolocation floor.
const REQUEST_REQS: Req[] = [
  { label: FIELD_LABELS.title, keys: ["title"] },
  { label: FIELD_LABELS.source_media, keys: ["source_media"], inheritedOnFulfil: true },
  { label: FIELD_LABELS.source_url, keys: ["source_url"] },
  { label: FIELD_LABELS.source_posted_at, keys: ["source_posted_at"] },
];

// What a full geolocation adds on top of the request floor.
const GEO_EXTRA_REQS: Req[] = [
  { label: FIELD_LABELS.coordinates, keys: ["coordinates"] },
  { label: FIELD_LABELS.proof_image, keys: ["proof", "proof_image"] },
  { label: FIELD_LABELS.conflict_tag, keys: ["conflict_tag"] },
  { label: FIELD_LABELS.capture_source_tag, keys: ["capture_source_tag"] },
];

// The readiness tick-list: one static Pill per requirement (`secondary` tone once met,
// `neutral` while pending), so it can't be mistaken for a selectable chip.
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
  // `useSearchParams` opts out of static prerender, so Next requires a Suspense boundary.
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

  // Entry path, seeded to the archive on-ramp from `?import=1` (the onboarding and /import
  // redirect target).
  const [mode, setMode] = useState<Mode>(
    searchParams.get("import") === "1" ? "bulk" : "single"
  );

  // Every field both publish paths fill, empty: the form mounts before a request it may be
  // fulfilling has loaded, so the effect below seeds what that request carries. `invalidKeys`
  // drive the in-form red outlines, set when a publish is clicked while its floor is short.
  // The tick-list is the standing summary, so no notice banner.
  const form = useEventForm();
  const { invalidKeys, flagIncomplete, clearIncomplete } = form;
  // The pre-fill effect's setters, pulled out as stable functions so the effect doesn't depend
  // on the state bundle (new every render).
  const {
    setTitle,
    setSourceUrl,
    setSecondarySourceUrls,
    setSecondarySnapshotUrls,
    setIsGraphic,
    setEventDate,
    setEventTime,
    setSourcePostedAt,
    setProof,
    setSelectedTagIds,
    setSelectedConflictIds,
  } = form;

  // Load the request being fulfilled to pre-fill and lock inherited fields. The server forces
  // only `source_url` and media from the request; title, dates, proof and tags are
  // form-sourced, so this pre-fill is their only carry-over.
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
        // A `requested` row always carries a source_url (CHECK ties it to status); `?? ""` only
        // satisfies the nullable wire type.
        setSourceUrl(b.source_url ?? "");
        // Mirrors carry over: fulfilment replaces the whole list server side.
        setSecondarySourceUrls(b.secondary_source_urls);
        // Blank pastes, one per mirror: the request's copies are shown by the rows, not re-posted.
        setSecondarySnapshotUrls(b.secondary_source_urls.map(() => ""));
        // Carry over the dates the poster knew and the in-progress proof (the form mounts after the
        // request loads, so the editor takes `proof` as its initial content).
        setIsGraphic(b.is_graphic);
        setEventDate(b.event_date ?? "");
        setEventTime(b.event_time?.slice(0, 5) ?? "");
        setSourcePostedAt(toDatetimeLocalUTC(b.source_posted_at));
        setProof(b.proof ?? null);
        setSelectedTagIds(b.tags.map((t) => t.id));
        setSelectedConflictIds(b.conflicts.map((c) => c.id));
      })
      .catch((err: Error) => setRequestError(err.message));
  }, [
    requestIdParam,
    setTitle,
    setSourceUrl,
    setSecondarySourceUrls,
    setSecondarySnapshotUrls,
    setIsGraphic,
    setEventDate,
    setEventTime,
    setSourcePostedAt,
    setProof,
    setSelectedTagIds,
    setSelectedConflictIds,
  ]);

  // Stable reference (memoised in `useTaxonomy`) so the readiness memos can depend on it.
  const { curatedTags } = form.taxonomy;

  const lockedFromRequest = request !== null;
  // Import is offered only on a fresh create, not while fulfilling a request.
  const canImport = !lockedFromRequest;

  // The two publish paths share one error banner; each mutation clears the other.
  const requestMutation = useMutation(
    () =>
      createEventRequest({
        ...form.shared(),
        title: form.title.trim(),
        source_url: form.sourceUrl.trim(),
        // Optional guess, both-or-neither, strict parse like the camera point.
        ...parseGuessCoords(form.lat, form.lng),
        ...parseCaptureCoords(form.captureLat, form.captureLng),
        files: form.newFiles,
      }),
    {
      fallback: "Submission failed",
      onSuccess: (created) => router.push(`/requests/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    (): Promise<{ id: string }> => {
      // Required (gated by `geoReady`), strict parse like the camera point so a coordinate can't
      // read valid one way and invalid the other.
      const latNum = cleanNumber(form.lat) ?? NaN;
      const lngNum = cleanNumber(form.lng) ?? NaN;
      const capture = parseCaptureCoords(form.captureLat, form.captureLng);
      // Fulfilling is a lifecycle move on the same event: geolocate transfers ownership to the
      // fulfiller. Source media is already on the row; only proof images upload at publish.
      if (request) {
        return geolocateEventApi(request.id, {
          ...form.shared(),
          title: form.title,
          lat: latNum,
          lng: lngNum,
          ...capture,
          source_url: form.sourceUrl,
          remove_media_ids: [],
          files: [],
        });
      }
      return createEvent({
        ...form.shared(),
        title: form.title,
        lat: latNum,
        lng: lngNum,
        ...capture,
        source_url: form.sourceUrl,
        files: form.newFiles,
      });
    },
    {
      fallback: "Submission failed",
      onSuccess: (result) => router.push(`/events/${result.id}`),
    }
  );

  const error = requestMutation.error ?? geolocationMutation.error;
  const submitting = requestMutation.loading || geolocationMutation.loading;

  // Live readiness from the shared validators. A fulfilment's media comes from the request.
  // Memoised so field scans rerun only when an input changes.
  const geoMissing = useMemo(
    () =>
      missingEventFields(
        {
          title: form.title,
          lat: form.lat,
          lng: form.lng,
          sourceUrl: form.sourceUrl,
          sourcePostedAt: form.sourcePostedAt,
          proof: form.proof,
          mediaCount: form.newFiles.length,
          hasConflictTag: form.selectedConflictIds.length > 0,
          hasCaptureSourceTag: curatedTags.some(
            (t) =>
              t.category === "capture_source" && form.selectedTagIds.includes(t.id)
          ),
        },
        { requireMedia: !lockedFromRequest }
      ),
    [
      form.title,
      form.lat,
      form.lng,
      form.sourceUrl,
      form.sourcePostedAt,
      form.proof,
      form.newFiles.length,
      curatedTags,
      form.selectedTagIds,
      form.selectedConflictIds,
      lockedFromRequest,
    ]
  );
  const reqMissing = useMemo(
    () =>
      missingEventRequestFields({
        title: form.title,
        sourceUrl: form.sourceUrl,
        sourcePostedAt: form.sourcePostedAt,
        mediaCount: form.newFiles.length,
      }),
    [form.title, form.sourceUrl, form.sourcePostedAt, form.newFiles.length]
  );
  const geoMissingKeys = useMemo(
    () => new Set<MissingFieldKey>(geoMissing.map((m) => m.key)),
    [geoMissing]
  );
  const reqMissingKeys = useMemo(
    () => new Set<MissingFieldKey>(reqMissing.map((m) => m.key)),
    [reqMissing]
  );
  // Readiness drives button emphasis (dimmed while short). The button stays clickable so a
  // click still flags the gaps red.
  const geoReady =
    geoMissing.length === 0 && form.taxonomy.blockedMessage === null;
  const reqReady = reqMissing.length === 0;

  // Both publish handlers clear the shared error banner and prior red outlines before
  // re-validating.
  const resetActions = () => {
    requestMutation.reset();
    geolocationMutation.reset();
    clearIncomplete();
  };

  // A pasted snapshot that cannot be one (source or mirror) is caught before upload: the field
  // flags itself red and the publish says why. Not a missing field (archives are optional), so
  // it stays out of the tick-list.
  const snapshotUnusable =
    [form.sourceSnapshotUrl, ...form.secondarySnapshotUrls].some(
      (pasted) => pasted.trim() !== "" && !isSnapshotUrl(pasted)
    );

  const publishGeolocation = async () => {
    resetActions();
    // A pending or failed curated-tags or conflicts load is recoverable, not a missing field:
    // surface it in the banner (Retry lives above), not the outlines.
    if (form.taxonomy.blockedMessage !== null) {
      geolocationMutation.setError(form.taxonomy.blockedMessage);
      return;
    }
    if (snapshotUnusable) {
      geolocationMutation.setError(SNAPSHOT_HINT);
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
    if (snapshotUnusable) {
      requestMutation.setError(SNAPSHOT_HINT);
      return;
    }
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

  // Request referenced but still loading: block the form until it can pre-fill.
  if (requestIdParam && !request) {
    return <PageLoading label="Loading request…" />;
  }

  // Fulfilment is a distinct entry (its own title, only a geolocation to publish); locked
  // fields carry their own LockedHint and the readiness list teaches the floor.
  const pageTitle = lockedFromRequest ? "Geolocate a request" : "Submit";

  // Both import entries swap out the form for their panel: each writes detections server side
  // and leaves through the review queue.
  const showBulk = canImport && mode === "bulk";
  const showXPost = canImport && mode === "xpost";
  // On a fulfilment the request supplies media, so it drops out of the floor shown.
  const geoFulfilReqs = [
    ...REQUEST_REQS.filter((r) => !r.inheritedOnFulfil),
    ...GEO_EXTRA_REQS,
  ];

  return (
    <PageShell title={pageTitle}>
      {/* Entry paths (fresh create only). Single and From an X post share the one-event form;
          bulk swaps in the archive on-ramp. */}
      {canImport && (
        <div className="mt-4">
          <SegmentedControl
            aria-label="Submission mode"
            options={[
              {
                value: "single",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={13} strokeWidth={1.8} className="max-sm:hidden" />
                    Single
                  </span>
                ),
              },
              {
                value: "xpost",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="max-sm:hidden"><XGlyph size={12} /></span>
                    From an X post
                  </span>
                ),
              },
              {
                value: "bulk",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Archive size={13} strokeWidth={1.8} className="max-sm:hidden" />
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

      {/* On-ramps swap in for the form; it stays mounted (hidden) so its draft survives switching
          back. */}
      {showXPost && (
        <div className="mt-4">
          <ImportPostPanel />
        </div>
      )}

      {showBulk && (
        <div className="mt-4">
          <ImportArchivePanel username={user.username} />
        </div>
      )}

      {/* No `onSubmit` route: publish actions are explicit buttons, and one clicked while its
          floor is short flags the missing fields red. `noValidate` stops native bubbles. */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className={showBulk || showXPost ? "hidden" : "mt-4 space-y-6"}
        noValidate
      >
        <EventFormFields
          form={form}
          // The request being fulfilled (supplies the source media and URL the geolocate keeps);
          // null on a fresh create.
          row={request}
          mediaLocked={lockedFromRequest}
          sourceUrlLocked={lockedFromRequest}
        />

        <DuplicateProbe
          lat={form.lat}
          lng={form.lng}
          sourceUrl={form.sourceUrl}
          eventDate={form.eventDate}
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
          // Two outcomes gated on content: meet the request floor and a request can post; add the
          // extra rows and a geolocation can publish. A click while short flags the gaps red.
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
