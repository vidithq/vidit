"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
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
import { Card } from "@/components/ui/Card";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Tooltip } from "@/components/ui/Tooltip";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { EventShare } from "@/components/event/EventShare";
import { GeolocatorInviteCard, GeolocatorsPanel } from "@/components/event/GeolocatorCredit";
import { useEventApprovals } from "@/components/event/EventApprovals";
import { VersionSelector } from "@/components/event/VersionSelector";
import { useReportContent } from "@/components/report/useReportContent";
import type { EventDetail } from "@/types";

/**
 * The controls of one event, assembled once so no surface hand-assembles a row and controls can't
 * drift between them. They head the page's side column (`docs/design.md`, Event actions and
 * approvals), as a row of icon controls, left to right:
 *
 * 1. **The version selector**, on the event page of a published row.
 * 2. **Edit**, an icon, for the owner. Closing and the geolocators live on the edit page.
 * 3. **Share**.
 * 4. **Add to collection** for the owner and every co-geolocator, and **Geolocators** for a
 *    co-geolocator (where they leave). Each opens a panel under the header.
 * 5. **Request approval** for a geolocator of a published row, on the event page. It opens a
 *    dialog with the open requests and the picker that sends one.
 * 6. **Report** for every reader but the owner.
 *
 * The actions are that row, then a published row's approvals on the event page (the stamps,
 * Approve) and a pending geolocator invitation, or **Geolocate** on an open request's page.
 *
 * The hook returns nodes rather than rendering them because the actions and the panels land in
 * different slots. Called before a surface's early returns, with `event` null
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

const COLLECT_PANEL_ID = "add-to-collection-panel";
const CREDIT_PANEL_ID = "geolocators-panel";
const REPORT_PANEL_ID = "report-panel";

export interface EventActionsOptions {
  /** The row to act on. Null while it loads: every node comes back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (a credit change, an answered invitation). */
  onChanged?: () => void;
}

export interface EventActions {
  /** The panels the row's toggles open, for under the header. */
  panels: ReactNode;
  /** The block heading the page's side column. */
  actions: ReactNode;
}

/** A panel a row toggle opens. It mounts when opened and takes focus then, so a keyboard or
 *  screen reader user lands in it rather than back on the toggle. */
function TogglePanel({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} id={id} tabIndex={-1} className="outline-none">
      {children}
    </div>
  );
}

export function useEventActions({ event, surface, onChanged }: EventActionsOptions): EventActions {
  const { user } = useAuth();
  // The report control is its own state machine (works signed out, outlives other actions).
  const report = useReportContent("event", event?.id ?? "");
  const [collecting, setCollecting] = useState(false);
  const [crediting, setCrediting] = useState(false);

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

  // This hook survives a client navigation between rows, so per-event state follows the row, not
  // the mount: otherwise the next row opens with the previous one's panel open.
  useEffect(() => {
    setCollecting(false);
    setCrediting(false);
  }, [event?.id]);

  if (!event || !tiers) {
    return { panels: null, actions: null };
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

  const toggle = (open: boolean, setOpen: (open: boolean) => void, label: string, id: string, icon: ReactNode) => (
    <Button
      icon
      variant="ghost"
      onClick={() => setOpen(!open)}
      aria-controls={open ? id : undefined}
      aria-expanded={open}
      aria-label={label}
      // The open toggle wears the active-row paint, so the reader sees which control the panel
      // belongs to.
      className={open ? ACCENT_SURFACE : ""}
    >
      {icon}
    </Button>
  );

  const controls = [
    tiers.history && hasPublishedRecord(event) && (
      <VersionSelector
        key="versions"
        eventId={event.id}
        liveVersion={event.version_no}
        selected={event.version_no}
      />
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
    canCollect && (
      <Fragment key="collect">
        {toggle(collecting, setCollecting, "Add to collection", COLLECT_PANEL_ID, <CollectionIcon size={14} />)}
      </Fragment>
    ),
    canSeeCredit && (
      <Fragment key="credit">
        {toggle(crediting, setCrediting, "Geolocators", CREDIT_PANEL_ID, <Users size={14} />)}
      </Fragment>
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

  const geolocate = tiers.flow && isOpenRequest && (
    <span className="inline-flex items-center gap-1.5">
      <Link href={`/submit?request_id=${event.id}`} className={buttonClasses("primary")}>
        <MapPin size={14} />
        Geolocate
      </Link>
      <FieldHelp concept="geolocate_request" />
    </span>
  );

  return {
    // The panels open under the header, full width. They stack rather than replace each other:
    // each is its own titled card.
    panels: (
      <>
        {canSeeCredit && crediting && (
          <TogglePanel id={CREDIT_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Geolocators" concept="geolocators" margin="none" />
              <GeolocatorsPanel event={event} onChanged={() => onChanged?.()} />
            </Card>
          </TogglePanel>
        )}
        {canCollect && collecting && (
          <TogglePanel id={COLLECT_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Add to collection" margin="none" />
              <AddToCollectionPanel eventId={event.id} />
            </Card>
          </TogglePanel>
        )}
        {canReport && report.panel && <TogglePanel id={REPORT_PANEL_ID}>{report.panel}</TogglePanel>}
      </>
    ),
    actions: (
      <div className="space-y-4">
        {row("lg:justify-end")}
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
        {geolocate && <div className="flex lg:justify-end">{geolocate}</div>}
      </div>
    ),
  };
}
