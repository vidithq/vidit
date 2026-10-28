"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useStoredDraft } from "@/hooks/useStoredDraft";
import { createEvent, createEventRequest } from "@/lib/events";
import { draftUrls } from "@/lib/sources";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel, type ImportShell } from "@/components/geolocations/ImportPostPanel";
import { SubmitChooser } from "@/components/geolocations/SubmitChooser";
import { EventFormShell, useEventForm } from "@/components/geolocations/EventFormFields";
import {
  PUBLISHING_LABEL,
  PUBLISH_CONFIRM,
  PublishActions,
  REQUEST_CONFIRM,
  publishGeolocationButton,
  requestWriteButton,
} from "@/components/geolocations/PublishActions";
import { WRITE_FALLBACK, useEventWrite, writeGroup } from "@/components/geolocations/useEventWrite";
import { useDraftGeolocatorsByline } from "@/components/event/useGeolocatorsByline";
import { DuplicateProbe } from "@/components/geolocations/fields/DuplicateProbe";
import { eventHref, requestHref, submitHref, type SubmitMode } from "@/lib/routes";

// The page's paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. `single` serves both a geolocation and a request: the two publish actions unlock
// from the content (a placed coordinate plus evidence publishes a geolocation, bare footage
// posts a request).
const MODES: readonly SubmitMode[] = ["single", "xpost", "bulk"];

/** The path the query names: `mode`, or the archive on-ramp from the legacy `?import=1` (the
 *  onboarding and /import target). `null` is the chooser. */
function modeFrom(params: URLSearchParams): SubmitMode | null {
  const mode = MODES.find((m) => m === params.get("mode"));
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

  // Every field both publish paths fill, empty. A publish clicked while its floor is short
  // outlines the missing fields red.
  const form = useEventForm();
  // Above the shells with the draft: the picks survive a trip through the chooser. Only the
  // geolocation publish posts them.
  const geolocators = useDraftGeolocatorsByline();

  // The draft, the picks included, also survives a reload: it is stored in the browser for the
  // signed-in analyst, and a publish drops it.
  const draft = useMemo(
    () => ({ form: form.draft, geolocators: geolocators.picks }),
    [form.draft, geolocators.picks]
  );
  const stored = useStoredDraft(user ? `submit:${user.id}` : null, draft, (restored) => {
    form.restoreDraft(restored.form);
    geolocators.setPicks(restored.geolocators);
  });

  // Both publishes are public, so each arms on a first click and writes on the second. They
  // share one error banner; each click clears the other's.
  const geolocation = useEventWrite(form, {
    floor: "publish",
    post: async () => {
      const created = await createEvent(form.publishInput(geolocators.invitees));
      // The event is published: a refused link must not hold the redirect, or a retry would
      // publish it twice. The event page lists the links that hold.
      await form.siteLinks.save(created.id).catch(() => undefined);
      return created;
    },
    fallback: WRITE_FALLBACK.publish,
    onSuccess: (result) => {
      stored.clear();
      router.push(eventHref(result.id));
    },
    confirm: PUBLISH_CONFIRM,
    resetAll: () => writes.reset(),
  });
  const request = useEventWrite(form, {
    floor: "request",
    post: () => createEventRequest(form.requestInput()),
    fallback: WRITE_FALLBACK.publish,
    onSuccess: (created) => {
      stored.clear();
      router.push(requestHref(created.id));
    },
    confirm: REQUEST_CONFIRM,
    resetAll: () => writes.reset(),
  });
  const writes = writeGroup(geolocation, request);

  if (authLoading || !user || !stored.ready) {
    return <PageLoading />;
  }

  // The page's sticky actions: the publish buttons on one line, each counting the conditions it
  // still misses (a geolocation needs the request floor too), then the banner.
  const actions = (
    <PublishActions
      disabled={writes.busy}
      error={writes.error}
      help="action_submit"
      // The two buttons fill a 320px line: the `?` shows from `sm` up.
      helpFromSm
      buttons={[
        publishGeolocationButton(geolocation, "Publish geolocation"),
        requestWriteButton(request, "Publish request", PUBLISHING_LABEL),
      ]}
    />
  );

  // A path's back arrow returns to the chooser.
  const backToChooser = () => (fromChooser.current ? router.back() : router.push(submitHref()));

  // The draft lives in `form`, above both shells, so it survives a trip through the chooser: the
  // fields reseed from it when the form opens again.
  if (mode === "single") {
    // No `onSubmit`: the publishes are explicit buttons, and one clicked while its floor is short
    // flags the missing fields red.
    return (
      <EventFormShell
        form={form}
        title="Submit"
        byline={geolocators.byline}
        onBack={backToChooser}
        actions={actions}
        fields={{
          afterLocation: (
            <DuplicateProbe
              lat={form.lat}
              lng={form.lng}
              sourceUrl={form.sources.flatMap(draftUrls)[0] ?? ""}
              eventDate={form.eventDate}
            />
          ),
        }}
      />
    );
  }

  // Both import entries take the chooser's shell, their submit pinned like the form's publishes:
  // each writes detections server side and leaves through the review queue.
  const importShell: ImportShell = ({ actions, body }) => (
    <PageShell title="Submit" back onBack={backToChooser} stickyActions={actions}>
      {body}
    </PageShell>
  );
  if (mode === "xpost") return <ImportPostPanel shell={importShell} />;
  if (mode === "bulk") return <ImportArchivePanel username={user.username} shell={importShell} />;

  return (
    <PageShell title="Submit" column="wide">
      <SubmitChooser />
    </PageShell>
  );
}
