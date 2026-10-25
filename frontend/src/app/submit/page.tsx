"use client";

import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { createEvent, createEventRequest } from "@/lib/events";
import { draftUrls, sourceWriteError } from "@/lib/sources";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel } from "@/components/geolocations/ImportPostPanel";
import { MapPin, Megaphone } from "lucide-react";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { IconTile } from "@/components/ui/IconTile";
import { eventFormSlots, useEventForm } from "@/components/geolocations/EventFormFields";
import { PublishActions, usePublishAction } from "@/components/geolocations/PublishActions";
import { EventShell } from "@/components/event/EventShell";
import { useDraftGeolocatorsByline } from "@/components/event/useGeolocatorsByline";
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
  // Whether the entry under this one in the history is the chooser: the path was opened from it
  // on this page. Back then walks back to it, and otherwise opens it.
  const fromChooser = useRef(false);
  const lastMode = useRef(mode);
  useEffect(() => {
    fromChooser.current = mode !== null && lastMode.current === null;
    lastMode.current = mode;
  }, [mode]);

  // Every field both publish paths fill, empty. `invalidKeys` drive the in-form red outlines,
  // set when a publish is clicked while its floor is short, which also lists them in the notice
  // under the actions.
  const form = useEventForm();
  const { flagIncomplete, clearIncomplete } = form;
  // Above the shells with the draft: the picks survive a trip through the chooser. Only the
  // geolocation publish posts them.
  const geolocators = useDraftGeolocatorsByline();

  // The two publish paths share one error banner; each mutation clears the other.
  const requestMutation = useMutation(
    () => createEventRequest(form.requestInput()),
    {
      fallback: "Submission failed",
      onError: sourceWriteError,
      onSuccess: (created) => router.push(`/requests/${created.id}`),
    }
  );

  const geolocationMutation = useMutation(
    () => createEvent(form.publishInput(geolocators.invitees)),
    {
      fallback: "Submission failed",
      onError: sourceWriteError,
      onSuccess: (result) => router.push(eventHref(result.id)),
    }
  );

  const error = requestMutation.error ?? geolocationMutation.error;
  const submitting = requestMutation.loading || geolocationMutation.loading;

  // Both publish handlers clear the shared error banner and prior red outlines before
  // re-validating.
  const resetActions = () => {
    requestMutation.reset();
    geolocationMutation.reset();
    clearIncomplete();
  };

  // A running upload or a pasted snapshot that cannot be one holds the write: the publish says
  // why. Not a missing field (archives are optional), so it stays out of the counts.
  const blocked = sourcesBlockWrite(form.sources);

  // Both publishes are public, so each arms on a first click and writes on the second. Every
  // check runs on both clicks.
  const publishGeolocation = usePublishAction({
    check: () => {
      resetActions();
      // A pending or failed conflicts load is recoverable, not a missing field:
      // surface it in the banner (Retry lives above), not the outlines.
      if (form.taxonomy.blockedMessage !== null) {
        geolocationMutation.setError(form.taxonomy.blockedMessage);
        return false;
      }
      if (blocked) {
        geolocationMutation.setError(blocked);
        return false;
      }
      if (form.publishMissing.length) {
        flagIncomplete(form.publishMissing);
        return false;
      }
      return true;
    },
    write: () => void geolocationMutation.run(),
    confirm: "Click again to publish. The geolocation becomes public at version 1; later changes become versions.",
  });

  const publishRequest = usePublishAction({
    check: () => {
      resetActions();
      if (blocked) {
        requestMutation.setError(blocked);
        return false;
      }
      if (form.requestMissing.length) {
        flagIncomplete(form.requestMissing);
        return false;
      }
      return true;
    },
    write: () => void requestMutation.run(),
    confirm: "Click again to publish. The request becomes public, open for anyone to geolocate.",
  });

  if (authLoading || !user) {
    return <PageLoading />;
  }

  // The page's sticky actions: the publish buttons on one line, each counting the conditions it
  // still misses (a geolocation needs the request floor too), then the banner.
  const actions = (
    <PublishActions
      disabled={submitting}
      error={error}
      help="action_submit"
      // The two buttons fill a 320px line: the `?` shows from `sm` up.
      helpFromSm
      buttons={[
        {
          action: publishGeolocation,
          label: "Publish geolocation",
          busyLabel: "Publishing…",
          busy: geolocationMutation.loading,
          variant: "primary",
          icon: <MapPin size={14} strokeWidth={2} />,
          missing: form.publishMissing,
        },
        {
          action: publishRequest,
          label: "Publish request",
          busyLabel: "Publishing…",
          busy: requestMutation.loading,
          variant: "secondary",
          icon: <Megaphone size={14} strokeWidth={2} />,
          missing: form.requestMissing,
        },
      ]}
    />
  );

  // A path's back arrow returns to the chooser.
  const backToChooser = () => (fromChooser.current ? router.back() : router.push(submitHref()));

  // The draft lives in `form`, above both shells, so it survives a trip through the chooser: the
  // fields reseed from it when the form opens again.
  if (mode === "single") {
    const fields = eventFormSlots(form, {
      afterLocation: (
        <DuplicateProbe
          lat={form.lat}
          lng={form.lng}
          sourceUrl={form.sources.flatMap(draftUrls)[0] ?? ""}
          eventDate={form.eventDate}
        />
      ),
    });
    return (
      <EventShell
        title="Submit"
        titleField={fields.titleField}
        byline={geolocators.byline}
        onBack={backToChooser}
        actions={{
          pinned: actions,
          below: (
            <IncompleteFormAnnouncer
              attempt={form.validationAttempt}
              missing={form.missingFields.map((m) => m.label)}
            />
          ),
        }}
        body={{
          ...fields.body,
          // No `onSubmit` route: publish actions are explicit buttons, and one clicked while its
          // floor is short flags the missing fields red. `noValidate` stops native bubbles.
          form: { onSubmit: (e) => e.preventDefault(), noValidate: true },
        }}
      />
    );
  }

  // Both import entries take the chooser's shell: each writes detections server side and leaves
  // through the review queue.
  return (
    <PageShell title="Submit" back={mode !== null} onBack={backToChooser}>
      {mode === null && (
        <div role="group" aria-label="Submission mode" className="grid gap-4 sm:grid-cols-3">
          {MODES.map(({ mode, icon, title, note }) => (
            <IconTile key={mode} href={submitHref(mode)} icon={icon} title={title} note={note} />
          ))}
        </div>
      )}

      {mode === "xpost" && <ImportPostPanel />}

      {mode === "bulk" && <ImportArchivePanel username={user.username} />}
    </PageShell>
  );
}
