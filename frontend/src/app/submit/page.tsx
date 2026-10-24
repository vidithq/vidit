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
  parseGuessCoords,
  type MissingFieldKey,
} from "@/lib/events";
import { draftUrls, sourceFloor, sourceWriteError } from "@/lib/sources";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import type { EventDetail } from "@/types";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel } from "@/components/geolocations/ImportPostPanel";
import { Archive, Check, Circle, MapPin, Megaphone } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Pill } from "@/components/ui/Pill";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import {
  EventFormFields,
  seedSources,
  useEventForm,
} from "@/components/geolocations/EventFormFields";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { eventHref } from "@/lib/routes";

// Three entry paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. There is no geolocation-vs-request pick: the two publish actions unlock from the
// content (a placed coordinate plus evidence publishes a geolocation, bare footage posts a
// request).
type Mode = "single" | "xpost" | "bulk";

// A publish-floor requirement shown as a tick. `keys` are the `missingEvent*` field keys it
// covers (proof needs two), so met state derives from the live missing set and the validator
// stays the one source of truth.
type Req = { label: string; keys: MissingFieldKey[] };

// The request floor: enough to be actionable by someone else, a subset of the geolocation floor.
const REQUEST_REQS: Req[] = [
  { label: FIELD_LABELS.title, keys: ["title"] },
  { label: FIELD_LABELS.source_file, keys: ["source_file"] },
  { label: FIELD_LABELS.source_link, keys: ["source_link"] },
];

// What a full geolocation adds on top of the request floor.
const GEO_EXTRA_REQS: Req[] = [
  { label: FIELD_LABELS.coordinates, keys: ["coordinates"] },
  { label: FIELD_LABELS.sensor, keys: ["sensor"] },
  { label: FIELD_LABELS.proof_image, keys: ["proof", "proof_image"] },
  { label: FIELD_LABELS.conflict_tag, keys: ["conflict_tag"] },
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
    setSources,
    setEventDate,
    setEventTime,
    setProof,
    setSelectedTagIds,
    setSelectedConflictIds,
  } = form;

  // Load the request being fulfilled to pre-fill the form. Its sources stay editable: the
  // geolocate posts the whole list, each kept source with its id.
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
        setSources(seedSources(b));
        // The form mounts after the request loads, so the editor takes `proof` as its initial
        // content.
        setEventDate(b.occurred_date ?? "");
        setEventTime(b.occurred_time?.slice(0, 5) ?? "");
        setProof(b.proof ?? null);
        setSelectedTagIds(b.tags.map((t) => t.id));
        setSelectedConflictIds(b.conflicts.map((c) => c.id));
      })
      .catch((err: Error) => setRequestError(err.message));
  }, [
    requestIdParam,
    setTitle,
    setSources,
    setEventDate,
    setEventTime,
    setProof,
    setSelectedTagIds,
    setSelectedConflictIds,
  ]);

  const fulfilling = request !== null;
  // Import is offered only on a fresh create, not while fulfilling a request.
  const canImport = !fulfilling;

  // The two publish paths share one error banner; each mutation clears the other.
  const requestMutation = useMutation(
    () =>
      createEventRequest({
        ...form.shared(),
        // Optional guess, both-or-neither, strict parse.
        ...parseGuessCoords(form.lat, form.lng),
      }),
    {
      fallback: "Submission failed",
      onError: sourceWriteError,
      onSuccess: (created) => router.push(`/requests/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    (): Promise<{ id: string }> => {
      // Required (gated by `geoReady`), strict parse so a coordinate can't read valid one way and
      // invalid the other.
      const input = {
        ...form.shared(),
        lat: cleanNumber(form.lat) ?? NaN,
        lng: cleanNumber(form.lng) ?? NaN,
      };
      // Fulfilling is a lifecycle move on the same event: geolocate transfers ownership to the
      // fulfiller.
      return request ? geolocateEventApi(request.id, input) : createEvent(input);
    },
    {
      fallback: "Submission failed",
      onError: sourceWriteError,
      onSuccess: (result) => router.push(eventHref(result.id)),
    }
  );

  const error = requestMutation.error ?? geolocationMutation.error;
  const submitting = requestMutation.loading || geolocationMutation.loading;

  // Live readiness from the shared validators, memoised so the scans rerun only when an input
  // changes.
  const floor = useMemo(() => sourceFloor(form.sources), [form.sources]);
  const geoMissing = useMemo(
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
  const reqMissing = useMemo(
    () => missingEventRequestFields({ title: form.title, sources: floor }),
    [form.title, floor]
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

  // A running upload or a pasted snapshot that cannot be one holds the write: the publish says
  // why. Not a missing field (archives are optional), so it stays out of the tick-list.
  const blocked = sourcesBlockWrite(form.sources);

  const publishGeolocation = async () => {
    resetActions();
    // A pending or failed curated-tags or conflicts load is recoverable, not a missing field:
    // surface it in the banner (Retry lives above), not the outlines.
    if (form.taxonomy.blockedMessage !== null) {
      geolocationMutation.setError(form.taxonomy.blockedMessage);
      return;
    }
    if (blocked) {
      geolocationMutation.setError(blocked);
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
    if (blocked) {
      requestMutation.setError(blocked);
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

  // Fulfilment is a distinct entry (its own title, only a geolocation to publish); the
  // readiness list teaches the floor.
  const pageTitle = fulfilling ? "Geolocate a request" : "Submit";

  // Both import entries swap out the form for their panel: each writes detections server side
  // and leaves through the review queue.
  const showBulk = canImport && mode === "bulk";
  const showXPost = canImport && mode === "xpost";
  const geoFulfilReqs = [...REQUEST_REQS, ...GEO_EXTRA_REQS];

  // The rail holds the conditions and the publish actions, as on the edit page; on a phone it
  // follows the fields. An import entry hides the form, and the rail with it.
  const rail =
    showBulk || showXPost ? null : (
      <Card as="section">
        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}

        {fulfilling ? (
          // Fulfilment can only become a geolocation: one action, no request path.
          <>
            <div className="space-y-2">
              <SectionEyebrow title="Geolocation" concept="submit_geolocation" margin="none" />
              <ReqChecklist reqs={geoFulfilReqs} missing={geoMissingKeys} />
            </div>
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
          </>
        ) : (
          // Two outcomes gated on content: meet the request floor and a request can post; add the
          // extra rows and a geolocation can publish. A click while short flags the gaps red.
          <>
            <div className="space-y-2">
              <SectionEyebrow title="Request" concept="submit_request" margin="none" />
              <ReqChecklist reqs={REQUEST_REQS} missing={reqMissingKeys} />
            </div>
            <div className="space-y-2">
              <SectionEyebrow
                title="Geolocation"
                concept="submit_geolocation_extra"
                margin="none"
              />
              <ReqChecklist reqs={GEO_EXTRA_REQS} missing={geoMissingKeys} />
            </div>
            <div className="flex flex-wrap gap-3">
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
          </>
        )}
      </Card>
    );

  return (
    <PageShell
      title={pageTitle}
      rail={rail}
      railLabel="Actions"
      narrowRail="below"
      controls={
        // Entry paths (fresh create only). Single and From an X post share the one-event form;
        // bulk swaps in the archive on-ramp.
        canImport && (
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
        )
      }
    >
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
        className={showBulk || showXPost ? "hidden" : "space-y-6"}
        noValidate
      >
        <EventFormFields form={form} row={request} />

        <DuplicateProbe
          lat={form.lat}
          lng={form.lng}
          sourceUrl={form.sources.flatMap(draftUrls)[0] ?? ""}
          eventDate={form.eventDate}
          skip={fulfilling}
        />
      </form>
    </PageShell>
  );
}
