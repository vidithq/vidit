"use client";

import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { createEvent, createEventRequest } from "@/lib/events";
import { draftUrls } from "@/lib/sources";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ImportArchivePanel } from "@/components/geolocations/ImportArchivePanel";
import { ImportPostPanel, type ImportShell } from "@/components/geolocations/ImportPostPanel";
import { MapPin, MapPinPlus } from "lucide-react";
import { IconTile } from "@/components/ui/IconTile";
import { CollectionIcon, newCollectionHref } from "@/lib/collections";
import { NEW_SITE_HREF } from "@/lib/sites";
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
import { IMPORT_GLYPH } from "@/lib/importEntries";
import { eventHref, requestHref, submitHref, type SubmitMode } from "@/lib/routes";

type ChooserTile = { icon: ReactNode; title: string; note: string };

// Three entry paths, differing only in where the work starts: `single` is one event by hand,
// `xpost` reads one of your own X posts into a detection you review, `bulk` backfills an
// archive. There is no geolocation-vs-request pick: the two publish actions unlock from the
// content (a placed coordinate plus evidence publishes a geolocation, bare footage posts a
// request).
const MODES: (ChooserTile & { mode: SubmitMode })[] = [
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

// The chooser's last tiles open a create page of their own, not a path of this one.
const CREATE_LINKS: (ChooserTile & { href: string })[] = [
  {
    href: NEW_SITE_HREF,
    icon: <MapPinPlus size={13} strokeWidth={1.8} />,
    title: "Site",
    note: "Follow a place through dated satellite imagery.",
  },
  {
    href: newCollectionHref(),
    icon: <CollectionIcon size={13} strokeWidth={1.8} />,
    title: "Collection",
    note: "Gather events into a curated list you can share.",
  },
];

const CHOOSER_TILES = [
  ...MODES.map(({ mode, ...tile }) => ({ ...tile, href: submitHref(mode) })),
  ...CREATE_LINKS,
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

  // Every field both publish paths fill, empty. A publish clicked while its floor is short
  // outlines the missing fields red.
  const form = useEventForm();
  // Above the shells with the draft: the picks survive a trip through the chooser. Only the
  // geolocation publish posts them.
  const geolocators = useDraftGeolocatorsByline();

  // Both publishes are public, so each arms on a first click and writes on the second. They
  // share one error banner; each click clears the other's.
  const geolocation = useEventWrite(form, {
    floor: "publish",
    post: () => createEvent(form.publishInput(geolocators.invitees)),
    fallback: WRITE_FALLBACK.publish,
    onSuccess: (result) => router.push(eventHref(result.id)),
    confirm: PUBLISH_CONFIRM,
    resetAll: () => writes.reset(),
  });
  const request = useEventWrite(form, {
    floor: "request",
    post: () => createEventRequest(form.requestInput()),
    fallback: WRITE_FALLBACK.publish,
    onSuccess: (created) => router.push(requestHref(created.id)),
    confirm: REQUEST_CONFIRM,
    resetAll: () => writes.reset(),
  });
  const writes = writeGroup(geolocation, request);

  if (authLoading || !user) {
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
    <PageShell title="Submit">
      <div role="group" aria-label="Submission mode" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CHOOSER_TILES.map(({ href, icon, title, note }) => (
          <IconTile key={href} href={href} icon={icon} title={title} note={note} />
        ))}
      </div>
    </PageShell>
  );
}
