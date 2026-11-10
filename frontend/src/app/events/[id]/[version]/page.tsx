"use client";

import type { EventDetail, EventVersion } from "@/types";
import { useFiledVersion } from "@/hooks/useVersionPage";
import { eventVersionPath, eventVersion, eventVersioned } from "@/lib/events";
import { VersionApprovals } from "@/components/event/Approvals";
import { eventPageSlots } from "@/components/event/EventDetailBody";
import { eventLocation } from "@/components/event/EventLocation";
import { EventByline } from "@/components/event/EventReadPage";
import { EventShell } from "@/components/event/EventShell";
import { EventVersionBanner } from "@/components/event/EventVersionBanner";
import { VersionSelector } from "@/components/event/VersionSelector";
import { EmptyState } from "@/components/ui/EmptyState";
import { eventHref } from "@/lib/routes";

/**
 * One filed version at `/events/{id}/vN`: the canonical body fed the version's
 * snapshot, read-only. The version selector is its one sticky action, and the
 * side column opens with the version's approvals (the other actions act on the
 * record).
 */
export default function EventVersionPage() {
  const filed = useFiledVersion<EventDetail, EventVersion>({
    recordPath: (id) => `/events/${id}`,
    versionPath: eventVersionPath,
    versioned: eventVersioned,
    href: eventHref,
  });
  if (filed.gate) return filed.gate;
  const { record: geo, versioned, number, row, producedBy } = filed;

  const version = eventVersion(geo, number, { own: row, producedBy });

  return (
    <EventShell
      title={version.view?.title ?? geo.title}
      byline={
        // Version 0 is the request or the detection, credited like its history row: to who opened
        // it, before anyone published it or joined it as a geolocator.
        <EventByline
          event={number === 0 && version.editor ? { owner: version.editor, geolocators: [] } : geo}
        />
      }
      actions={{
        pinned: <VersionSelector record={versioned} selected={number} />,
        // Version 0 was never published, so nothing approves it.
        below: number > 0 ? <VersionApprovals event={geo} versionNo={number} /> : null,
      }}
      panels={
        <>
          <EventVersionBanner event={geo} version={version} />
          {!version.view && (
            <EmptyState>
              An administrator redacted this version, so its content is no longer
              served. The version keeps its number and its place in the history.
            </EmptyState>
          )}
        </>
      }
      body={version.view ? eventPageSlots(version.view, eventLocation(version.view)) : undefined}
    />
  );
}
