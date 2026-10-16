"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleX, Ellipsis, Flag, History, MapPin, Pencil, Users } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { allApprovalsPath, type ApprovalList } from "@/lib/approvals";
import { COLLECTABLE_STATUSES, CollectionIcon } from "@/lib/collections";
import { eventHistoryHref, hasPublishedRecord } from "@/lib/events";
import { AddToCollectionPanel } from "@/components/collections/AddToCollectionPanel";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { closeActionLabel, CloseEventForm } from "@/components/event/CloseEventForm";
import { EventShare } from "@/components/event/EventShare";
import { GeolocatorInviteCard, GeolocatorsPanel } from "@/components/event/GeolocatorCredit";
import { ApproveShortcut, VerificationCard } from "@/components/event/Verification";
import { useReportContent } from "@/components/report/useReportContent";
import type { EventDetail } from "@/types";

/**
 * The header of one event, assembled once so no surface hand-assembles a row and controls can't
 * drift between them. Three controls, left to right, in the surface's top-right slot
 * (`docs/design.md`, Event header):
 *
 * 1. **The primary action**, at most one, filled. On the request page, Geolocate. On the event
 *    page, Edit for the owner, or Approve version N for a reader who may approve.
 * 2. **Share**: the device's share sheet, or a menu with Copy link and Share on X.
 * 3. **More**: everything else that applies to this reader and row: Version history, Geolocators,
 *    Add to collection, the close, and Report. Each opens a panel under the header (Version
 *    history navigates). Nothing here destroys a row: closing keeps it readable with its reason.
 *
 * On the event page of a published row the hook also returns the Verification card (status,
 * approvals, the approve form, review requests), which the page renders beside the body.
 *
 * The hook returns nodes rather than rendering them because the header, the panels and the card
 * land in different slots. Called before a surface's early returns, with `event` null while the
 * row loads, so hook order is stable.
 */

/** Which surface is asking, which is what selects the controls. */
export type ActionSurface = "event" | "request" | "panel" | "edit";

// One flag per control family per surface. The map panel and edit form render nothing (the panel
// previews a row whose page is one click away; a form's own submit is its action, and sharing a
// record mid-rewrite acts on something other than what is on screen).
//
// `utilities` is Share and Report, which any reader of the record may use. `flow` is geolocating an
// open request. `collect` shelves the row on one of the reader's
// collections, `editRequest` corrects an open request, `saveVersion` corrects a published
// geolocation, `close` takes a row back. `history`, `credit` and `approvals` (the Verification
// card) belong to the event page, the one surface serving the published record.
const TIERS: Record<
  ActionSurface,
  {
    flow: boolean;
    collect: boolean;
    editRequest: boolean;
    saveVersion: boolean;
    close: boolean;
    history: boolean;
    utilities: boolean;
    credit: boolean;
    approvals: boolean;
  }
> = {
  event:   { flow: false, collect: true,  editRequest: true,  saveVersion: true,  close: true,  history: true,  utilities: true,  credit: true,  approvals: true },
  request: { flow: true,  collect: false, editRequest: true,  saveVersion: false, close: true,  history: false, utilities: true,  credit: false, approvals: false },
  panel:   { flow: false, collect: false, editRequest: false, saveVersion: false, close: false, history: false, utilities: false, credit: false, approvals: false },
  edit:    { flow: false, collect: false, editRequest: false, saveVersion: false, close: false, history: false, utilities: false, credit: false, approvals: false },
};

const CLOSE_FORM_ID = "close-request-form";
const COLLECT_PANEL_ID = "add-to-collection-panel";
const CREDIT_PANEL_ID = "geolocators-panel";
const REPORT_PANEL_ID = "report-panel";

export interface EventActionsOptions {
  /** The row to act on. Null while it loads: every node comes back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (close, a credit change). */
  onChanged?: () => void;
}

export interface EventActions {
  /** The header controls, for the surface's top-right slot. */
  actions: ReactNode;
  /** The panels the More menu opens, for the body under the header. */
  panels: ReactNode;
  /** The Verification card, on the event page of a published row only. */
  verification: ReactNode;
}

/** A panel the More menu opens. It mounts when opened and takes focus then, so a keyboard or
 *  screen reader user lands in it rather than back on the menu trigger. */
function MenuPanel({ id, children }: { id: string; children: ReactNode }) {
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
  const [closing, setClosing] = useState(false);
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
  const showsVerification = !!event && !!tiers?.approvals && hasPublishedRecord(event);
  const approvals = useApiResource<ApprovalList>(
    showsVerification ? allApprovalsPath(event.id) : null,
  );

  // This hook survives a client navigation between rows, so per-event state follows the row, not
  // the mount: otherwise the next row opens with the previous one's close panel open.
  useEffect(() => {
    setClosing(false);
    setCollecting(false);
    setCrediting(false);
  }, [event?.id]);

  if (!event || !tiers) return { actions: null, panels: null, verification: null };

  const isOpenRequest = event.status === "requested";

  // The owner's edit of an open request overwrites it; a published geolocation's edit files a
  // version. The two never apply to one row, and both lead to one edit address.
  const canEditRequest = isAuthor && tiers.editRequest && isOpenRequest;
  const canSaveVersion = isAuthor && tiers.saveVersion && event.status === "geolocated";
  // Every live state closes, `geolocated` included: a claim its author no longer stands behind is
  // retracted, not left standing or destroyed. `closed` is terminal, so the verb disappears.
  const canClose = isAuthor && tiers.close && event.status !== "closed";
  const closeLabel = closeActionLabel(event.status);
  // The two worked statuses only, the set a collection may hold
  // (`services/event_filters.collectable_events`).
  const canCollect =
    (isAuthor || isGeolocator) && tiers.collect && COLLECTABLE_STATUSES.includes(event.status);
  const canManageCredit = (isAuthor || isGeolocator) && sharesCredit;
  const invited =
    sharesCredit && !isAuthor && !isGeolocator && event.viewer_invite_pending === true &&
    answeredFor !== event.id;
  const geolocates = tiers.flow && isOpenRequest;

  const edit = (canEditRequest || canSaveVersion) && (
    <Link
      href={`/events/${event.id}/edit`}
      className={buttonClasses("primary")}
      // "Edit" alone would read as an in-place rewrite of a published record, which is corrected by
      // adding a version; a request is overwritten, so its name promises no version.
      aria-label={canSaveVersion ? "Edit this geolocation" : "Edit this request"}
      title={canSaveVersion ? "Edit this geolocation (saves a new version)" : "Edit this request"}
    >
      <Pencil size={14} />
      Edit
    </Link>
  );

  const primary = geolocates ? (
    <Link href={`/submit?request_id=${event.id}`} className={buttonClasses("primary")}>
      <MapPin size={14} />
      Geolocate
    </Link>
  ) : (
    edit ||
    (showsVerification && approvals.data && (
      <ApproveShortcut event={event} approvals={approvals.data} />
    ))
  );

  const more: ActionMenuItem[] = [
    // Public, since a corrected record is only auditable if any reader can walk the corrections.
    ...(tiers.history && hasPublishedRecord(event)
      ? [
          {
            key: "history",
            label: "Version history",
            icon: <History size={14} />,
            href: eventHistoryHref(event.id),
          },
        ]
      : []),
    // On the request page Geolocate holds the primary slot, so the asker's edit moves here.
    ...(geolocates && edit
      ? [
          {
            key: "edit",
            label: "Edit this request",
            icon: <Pencil size={14} />,
            href: `/events/${event.id}/edit`,
          },
        ]
      : []),
    ...(canManageCredit
      ? [
          {
            key: "credit",
            label: "Geolocators",
            icon: <Users size={14} />,
            active: crediting,
            onSelect: () => setCrediting(!crediting),
          },
        ]
      : []),
    ...(canCollect
      ? [
          {
            key: "collect",
            label: "Add to collection",
            icon: <CollectionIcon size={14} />,
            active: collecting,
            onSelect: () => setCollecting(!collecting),
          },
        ]
      : []),
    ...(canClose
      ? [
          {
            key: "close",
            label: closeLabel,
            icon: <CircleX size={14} />,
            active: closing,
            onSelect: () => setClosing(true),
          },
        ]
      : []),
    ...(tiers.utilities && report.toggle
      ? [
          {
            key: "report",
            label: "Report",
            icon: <Flag size={14} />,
            tone: "danger" as const,
            active: report.open,
            onSelect: report.toggle,
          },
        ]
      : []),
  ];

  // A surface with nothing to offer gets nothing rather than an empty row: the wrapper is an item
  // in the host's cluster, so an empty one prints a gap beside the host's own controls.
  const rowIsEmpty = !primary && !tiers.utilities && more.length === 0;

  // `flex-wrap` plus `justify-end`: a long primary label wraps the row into right-aligned lines
  // instead of pushing the header sideways (PageShell caps the cluster at the header width).
  const actions = rowIsEmpty ? null : (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {primary}
      {tiers.utilities && <EventShare event={event} />}
      {more.length > 0 && (
        <ActionMenu label="More actions" icon={<Ellipsis size={14} />} items={more} />
      )}
    </div>
  );

  return {
    actions,
    // The panels open directly under the header. They stack rather than replace each other: each
    // is its own titled card.
    panels: (
      <>
        {invited && (
          <GeolocatorInviteCard
            event={event}
            onAnswered={() => {
              setAnsweredFor(event.id);
              onChanged?.();
            }}
          />
        )}
        {canManageCredit && crediting && (
          <MenuPanel id={CREDIT_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Geolocators" margin="none" />
              <GeolocatorsPanel event={event} onChanged={() => onChanged?.()} />
            </Card>
          </MenuPanel>
        )}
        {canCollect && collecting && (
          <MenuPanel id={COLLECT_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Add to collection" margin="none" />
              <AddToCollectionPanel eventId={event.id} />
            </Card>
          </MenuPanel>
        )}
        {closing && (
          <MenuPanel id={CLOSE_FORM_ID}>
            <Card as="section">
              <SectionEyebrow title={closeLabel} margin="none" />
              <CloseEventForm
                eventId={event.id}
                status={event.status}
                onClosed={() => {
                  setClosing(false);
                  onChanged?.();
                }}
                onCancel={() => setClosing(false)}
              />
            </Card>
          </MenuPanel>
        )}
        {report.panel && <MenuPanel id={REPORT_PANEL_ID}>{report.panel}</MenuPanel>}
      </>
    ),
    verification: showsVerification ? (
      <VerificationCard event={event} approvals={approvals} />
    ) : null,
  };
}
