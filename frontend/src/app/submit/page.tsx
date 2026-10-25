"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import Link from "next/link";
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
import { ArrowLeft, MapPin, Megaphone } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { IconTile } from "@/components/ui/IconTile";
import { EventFormLayout, useEventForm } from "@/components/geolocations/EventFormFields";
import {
  GEO_EXTRA_REQS,
  REQUEST_REQS,
  usePublishConditions,
} from "@/components/geolocations/PublishChecklist";
import { sourcesBlockWrite } from "@/components/sources/SourcesField";
import { DuplicateProbe } from "@/components/geolocations/new/DuplicateProbe";
import { IMPORT_GLYPH } from "@/lib/importEntries";
import { eventHref, submitHref, type SubmitMode } from "@/lib/routes";

// Three entry paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. There is no geolocation-vs-request pick: the two publish actions unlock from the
// content (a placed coordinate plus evidence publishes a geolocation, bare footage posts a
// request).
const MODES: { mode: SubmitMode; icon: ReactNode; title: string; note: string }[] = [
  {
    mode: "single",
    icon: <MapPin size={13} strokeWidth={1.8} />,
    title: "Single event",
    note: "Geolocate one event, or ask the community to geolocate it.",
  },
  {
    mode: "xpost",
    icon: IMPORT_GLYPH.paste,
    title: "From an X post",
    note: "Paste a link to one of your own posts. It becomes a detection you review.",
  },
  {
    mode: "bulk",
    icon: IMPORT_GLYPH.archive,
    title: "Bulk import",
    note: "Upload your X archive. Each geolocation in your posts becomes a detection to review.",
  },
];

/** The path the query names: `mode`, or the archive on-ramp from the legacy `?import=1` (the
 *  onboarding and /import target). `null` is the chooser. */
function modeFrom(params: URLSearchParams): SubmitMode | null {
  const mode = MODES.find((m) => m.mode === params.get("mode"))?.mode;
  if (mode) return mode;
  return params.get("import") === "1" ? "bulk" : null;
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

  const mode = modeFrom(searchParams);

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

  // Two outcomes gated on content: meet the request floor and a request can post; add the extra
  // rows and a geolocation can publish. A click while short flags the gaps red.
  const conditions = usePublishConditions([
    { title: "Request", concept: "submit_request", reqs: REQUEST_REQS, missing: reqMissingKeys },
    {
      title: "Geolocation",
      concept: "submit_geolocation_extra",
      reqs: GEO_EXTRA_REQS,
      missing: geoMissingKeys,
    },
  ]);

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
  const showForm = mode === "single";

  // The page's sticky actions: the publish buttons, the conditions under them, then the banner.
  const actions = (
    <aside aria-label="Actions" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
        {conditions.toggle}
      </div>
      {conditions.list}
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}
    </aside>
  );

  return (
    <PageShell
      title="Submit"
      wide={showForm}
      stickyActions={showForm ? actions : undefined}
      controls={
        mode !== null && (
          <Link href={submitHref()} className={buttonClasses("ghost", { className: "-ml-2" })}>
            <ArrowLeft size={14} strokeWidth={2} />
            Other ways to submit
          </Link>
        )
      }
    >
      {mode === null && (
        <div role="group" aria-label="Submission mode" className="grid gap-4 sm:grid-cols-3">
          {MODES.map(({ mode, icon, title, note }) => (
            <IconTile key={mode} href={submitHref(mode)} icon={icon} title={title} note={note} />
          ))}
        </div>
      )}

      {mode === "xpost" && <ImportPostPanel />}

      {mode === "bulk" && <ImportArchivePanel username={user.username} />}

      {/* Stays mounted (hidden) on the other paths, so its draft survives a trip through the
          chooser. */}
      <div className={showForm ? undefined : "hidden"}>
        <EventFormLayout
          form={form}
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
