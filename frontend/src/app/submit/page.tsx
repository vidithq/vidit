"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cleanNumber } from "@/lib/coordinates";
import {
  createEvent,
  createEventRequest,
  missingEventFields,
  missingEventRequestFields,
  parseGuessCoords,
  type MissingFieldKey,
} from "@/lib/events";
import { draftUrls, sourceFloor, sourceWriteError } from "@/lib/sources";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel } from "@/components/geolocations/ImportPostPanel";
import { Archive, MapPin, Megaphone } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { EventFormLayout, useEventForm } from "@/components/geolocations/EventFormFields";
import {
  GEO_EXTRA_REQS,
  PublishChecklist,
  REQUEST_REQS,
} from "@/components/geolocations/PublishChecklist";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { eventHref } from "@/lib/routes";

// Three entry paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. There is no geolocation-vs-request pick: the two publish actions unlock from the
// content (a placed coordinate plus evidence publishes a geolocation, bare footage posts a
// request).
type Mode = "single" | "xpost" | "bulk";

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

  // Entry path, seeded to the archive on-ramp from `?import=1` (the onboarding and /import
  // redirect target).
  const [mode, setMode] = useState<Mode>(
    searchParams.get("import") === "1" ? "bulk" : "single"
  );

  // Every field both publish paths fill, empty. `invalidKeys` drive the in-form red outlines,
  // set when a publish is clicked while its floor is short. The tick-list is the standing
  // summary, so no notice banner.
  const form = useEventForm();
  const { flagIncomplete, clearIncomplete } = form;

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
    // Required (gated by `geoReady`), strict parse so a coordinate can't read valid one way and
    // invalid the other.
    () =>
      createEvent({
        ...form.shared(),
        lat: cleanNumber(form.lat) ?? NaN,
        lng: cleanNumber(form.lng) ?? NaN,
      }),
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
    // A pending or failed conflicts load is recoverable, not a missing field:
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

  // Both import entries swap out the form for their panel: each writes detections server side
  // and leaves through the review queue.
  const showBulk = mode === "bulk";
  const showXPost = mode === "xpost";

  // The actions hold the conditions and the publish buttons, as on the edit page; on a phone they
  // follow the fields.
  const actions = (
    <Card as="section">
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}

      {/* Two outcomes gated on content: meet the request floor and a request can post; add the
          extra rows and a geolocation can publish. A click while short flags the gaps red. */}
      <div className="space-y-2">
        <SectionEyebrow title="Request" concept="submit_request" margin="none" />
        <PublishChecklist reqs={REQUEST_REQS} missing={reqMissingKeys} />
      </div>
      <div className="space-y-2">
        <SectionEyebrow title="Geolocation" concept="submit_geolocation_extra" margin="none" />
        <PublishChecklist reqs={GEO_EXTRA_REQS} missing={geoMissingKeys} />
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
    </Card>
  );

  return (
    <PageShell
      title="Submit"
      wide={!showBulk && !showXPost}
      controls={
        // Entry paths. Single and From an X post share the one-event form; bulk swaps in the
        // archive on-ramp.
        (
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

      <div className={showBulk || showXPost ? "hidden" : undefined}>
        <EventFormLayout
          form={form}
          actions={actions}
          actionsLabel="Actions"
          // No `onSubmit` route: publish actions are explicit buttons, and one clicked while its
          // floor is short flags the missing fields red. `noValidate` stops native bubbles.
          formProps={{ onSubmit: (e) => e.preventDefault(), noValidate: true }}
          afterLocation={
            <DuplicateProbe
              lat={form.lat}
              lng={form.lng}
              sourceUrl={form.sources.flatMap(draftUrls)[0] ?? ""}
              eventDate={form.eventDate}
            />
          }
        />
      </div>
    </PageShell>
  );
}
