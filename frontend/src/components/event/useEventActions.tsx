"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { MapPin, SquarePen, Users } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { cn } from "@/lib/cn";
import { allApprovalsPath, type ApprovalList } from "@/lib/approvals";
import { COLLECTABLE_STATUSES, CollectionIcon } from "@/lib/collections";
import { hasPublishedRecord } from "@/lib/events";
import { AddToCollectionPanel } from "@/components/collections/AddToCollectionPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Popover } from "@/components/ui/Popover";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Tooltip } from "@/components/ui/Tooltip";
import { EventShare } from "@/components/event/EventShare";
import { GeolocatorInviteCard, GeolocatorsPanel } from "@/components/event/GeolocatorCredit";
import type { EventShellActions } from "@/components/event/EventShell";
import { useEventApprovals } from "@/components/event/EventApprovals";
import { VersionSelector } from "@/components/event/VersionSelector";
import { useReportContent } from "@/components/report/useReportContent";
import type { EventDetail } from "@/types";

/**
 * The controls of one event, assembled once so no surface hand-assembles a row and controls can't
 * drift between them. They head the page's actions block, top right (`docs/design.md`, Event
 * actions and approvals), as a row of icon controls, left to right:
 *
 * 1. **The version selector**, on the event page of a published row.
 * 2. **Edit**, an icon, for the owner. Closing and the geolocators live on the edit page.
 * 3. **Share**.
 * 4. **Add to collection** for the owner and every co-geolocator, and **Geolocators** for a
 *    co-geolocator (where they leave). Each is a `<Popover>`: its panel floats over the page.
 * 5. **Request approval** for a geolocator of a published row, on the event page. It opens a
 *    dialog with the open requests and the picker that sends one.
 * 6. **Report** for every reader but the owner.
 *
 * The actions are `EventShell`'s actions block: the row, then **Geolocate** on an open request's
 * page, pinned while the page scrolls; under them, not pinned, a published row's approvals on the
 * event page (the stamps, Approve) and a pending geolocator invitation.
 *
 * The hook returns nodes rather than rendering them because the actions and the report form land
 * in different zones. Called before a surface's early returns, with `event` null
 * while the row loads, so hook order is stable.
 */

/** Which detail page is asking, which is what selects the controls. */
export type ActionSurface = "event" | "request";

// One flag per control family per surface. `utilities` is Share and Report, which any reader of
// the record may use. `flow` is geolocating an open request. `edit` is the owner's way to the edit
// page. `collect` shelves the row on one of the reader's collections. `history` (the version
// selector), `credit` and `approvals` (the approvals under the row) belong to the event page, the one
// surface serving the published record.
const TIERS: Record<
  ActionSurface,
  {
    flow: boolean;
    edit: boolean;
    collect: boolean;
    history: boolean;
    utilities: boolean;
    credit: boolean;
    approvals: boolean;
  }
> = {
  event:   { flow: false, edit: true,  collect: true,  history: true,  utilities: true,  credit: true,  approvals: true },
  request: { flow: true,  edit: true,  collect: false, history: false, utilities: true,  credit: false, approvals: false },
};

export interface EventActionsOptions {
  /** The row to act on. Null while it loads: every node comes back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (a credit change, an answered invitation). */
  onChanged?: () => void;
}

export interface EventActions {
  /** The report form, a dialog, and the receipt a sent report leaves, for under the header. */
  panels: ReactNode;
  /** The actions block: the row and Geolocate on a request, pinned; the approvals and an
   *  invitation under them. */
  actions: EventShellActions | undefined;
}

export function useEventActions({ event, surface, onChanged }: EventActionsOptions): EventActions {
  const { user } = useAuth();
  // The report control is its own state machine (works signed out, outlives other actions).
  const report = useReportContent("event", event?.id ?? "");

  const tiers = event ? TIERS[surface] : null;
  const isAuthor = !!event && user?.id === event.owner.id;
  const isGeolocator = !!event && event.geolocators.some((g) => g.id === user?.id);
  // Mirrors backend geolocator_credit._require_published; change both.
  const sharesCredit = !!tiers?.credit && event?.status === "geolocated";
  // The event read says whether the reader holds an invitation; an answer hides the card at
  // once, before the caller's refetch lands.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const showsApprovals = !!event && !!tiers?.approvals && hasPublishedRecord(event);
  const approvals = useApiResource<ApprovalList>(
    showsApprovals ? allApprovalsPath(event.id) : null,
  );
  const eventApprovals = useEventApprovals(showsApprovals ? event : null, approvals);

  if (!event || !tiers) {
    return { panels: null, actions: undefined };
  }

  const isOpenRequest = event.status === "requested";
  // The owner edits an open request (overwriting it), a detection, or a published geolocation
  // (adding a version). A closed row has no owner edit.
  const canEdit = isAuthor && tiers.edit && event.status !== "closed";
  // The two worked statuses only, the set a collection may hold
  // (`services/event_filters.collectable_events`).
  const canCollect =
    (isAuthor || isGeolocator) && tiers.collect && COLLECTABLE_STATUSES.includes(event.status);
  // The owner manages credit on the edit page; a co-geolocator reads it and leaves here.
  const canSeeCredit = !isAuthor && isGeolocator && sharesCredit;
  const invited =
    sharesCredit && !isAuthor && !isGeolocator && event.viewer_invite_pending === true &&
    answeredFor !== event.id;
  // Reporting your own event says nothing an edit or a close could not.
  const canReport = tiers.utilities && !isAuthor;

  const controls = [
    tiers.history && hasPublishedRecord(event) && (
      <VersionSelector key="versions" event={event} selected={event.version_no} />
    ),
    canEdit && (
      // A published record is corrected by adding a version, a request is overwritten: the
      // tooltip says which, so "Edit" never reads as an in-place rewrite of a published record.
      <Tooltip
        key="edit"
        label={event.status === "geolocated" ? "Edit (saves a new version)" : "Edit"}
      >
        <Link
          href={`/events/${event.id}/edit`}
          className={buttonClasses("ghost", { icon: true })}
          aria-label="Edit"
        >
          <SquarePen size={14} />
        </Link>
      </Tooltip>
    ),
    tiers.utilities && <EventShare key="share" event={event} />,
    // Keyed by the row: this hook survives a client navigation between rows, and the next row
    // must not open with the previous one's popover open.
    canCollect && (
      <Popover
        key={`collect-${event.id}`}
        label="Add to collection"
        icon={<CollectionIcon size={14} />}
      >
        {() => (
          <>
            <SectionEyebrow title="Add to collection" margin="none" />
            <AddToCollectionPanel eventId={event.id} />
          </>
        )}
      </Popover>
    ),
    canSeeCredit && (
      <Popover key={`credit-${event.id}`} label="Geolocators" icon={<Users size={14} />}>
        {() => (
          <>
            <SectionEyebrow title="Geolocators" concept="geolocators" margin="none" />
            <GeolocatorsPanel event={event} onChanged={() => onChanged?.()} />
          </>
        )}
      </Popover>
    ),
    eventApprovals.requestAction && (
      <Fragment key="request-approval">{eventApprovals.requestAction}</Fragment>
    ),
    canReport && <Fragment key="report">{report.trigger}</Fragment>,
  ].filter(Boolean);

  const row = (className?: string) =>
    controls.length > 0 && (
      <div
        role="group"
        aria-label="Event actions"
        className={cn("flex flex-wrap items-center gap-1.5", className)}
      >
        {controls}
      </div>
    );

  // `max-sm:pr-2`: the `?` grows its tap area 8px past its glyph on a phone, which stays inside
  // the row's right edge.
  const geolocate = tiers.flow && isOpenRequest && (
    <span className="inline-flex items-center gap-1.5 max-sm:pr-2">
      <Link href={`/events/${event.id}/edit`} className={buttonClasses("primary")}>
        <MapPin size={14} />
        Geolocate
      </Link>
      <FieldHelp concept="geolocate_request" />
    </span>
  );

  return {
    panels: canReport && report.panel,
    actions: {
      pinned: (controls.length > 0 || geolocate) && (
        <aside aria-label="Actions" className="flex flex-col items-end gap-3">
          {row("justify-end")}
          {geolocate}
        </aside>
      ),
      below: (eventApprovals.summary || invited) && (
        <div className="space-y-4">
          {eventApprovals.summary}
          {invited && (
            <GeolocatorInviteCard
              event={event}
              onAnswered={() => {
                setAnsweredFor(event.id);
                onChanged?.();
              }}
            />
          )}
        </div>
      ),
    },
  };
}
