"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { SquarePen, Users } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { allApprovalsPath, type ApprovalList } from "@/lib/approvals";
import { COLLECTABLE_STATUSES, CollectionIcon } from "@/lib/collections";
import { eventVersioned, hasPublishedRecord } from "@/lib/events";
import { answerGeolocatorInvite, creditedAuthors, removeGeolocator } from "@/lib/geolocatorCredit";
import { eventEditHref } from "@/lib/routes";
import { AddToCollectionPanel } from "@/components/collections/AddToCollectionPanel";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { ActionIcon, Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Popover } from "@/components/ui/Popover";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { Tooltip } from "@/components/ui/Tooltip";
import { WithheldBanner } from "@/components/ui/WithheldBanner";
import { EventShare } from "@/components/event/EventShare";
import { GeolocatorInviteCard, InviteAnswerButtons } from "@/components/event/GeolocatorCredit";
import type { EventShellActions } from "@/components/event/EventShell";
import { useEventApprovals } from "@/components/event/EventApprovals";
import { VersionSelector } from "@/components/event/VersionSelector";
import { useReportContent } from "@/components/report/useReportContent";
import { useEventSites } from "@/components/sites/useEventSites";
import type { EventDetail } from "@/types";

/**
 * The controls of one event, assembled once so no surface hand-assembles a row and controls can't
 * drift between them. The order and the audience of each control are in `docs/design.md` (Event
 * actions and approvals).
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
// selector), `credit`, `approvals` (the approvals under the row) and `sites` (the Sites block and
// Link to a site) belong to the event page, the one surface serving the published record.
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
    sites: boolean;
  }
> = {
  event:   { flow: false, edit: true,  collect: true,  history: true,  utilities: true,  credit: true,  approvals: true,  sites: true },
  request: { flow: true,  edit: true,  collect: false, history: false, utilities: true,  credit: false, approvals: false, sites: false },
};

interface EventActionsOptions {
  /** The row to act on. Null while it loads: every node comes back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (a credit change, an answered invitation). */
  onChanged?: () => void;
}

interface EventActions {
  /** The withheld banner, the geolocator invitation's card, the report form, a dialog, and the
   *  receipt a sent report leaves, for under the header. */
  panels: ReactNode;
  /** The actions block: the row, pinned; the approvals under it. */
  actions: EventShellActions | undefined;
  /** The event page's Sites block, for the side column. */
  sites: ReactNode;
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
  const sites = useEventSites(tiers?.sites ? event : null);

  if (!event || !tiers) {
    return { panels: null, actions: undefined, sites: null };
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
  // The asker's Edit opens the same form, so the asker gets Edit alone.
  const canGeolocate = tiers.flow && isOpenRequest && !canEdit;

  const controls = [
    tiers.history && hasPublishedRecord(event) && (
      <VersionSelector key="versions" record={eventVersioned(event)} selected={event.version_no} />
    ),
    canEdit && (
      // A published record is corrected by adding a version, a request is overwritten: the
      // tooltip says which, so "Edit" never reads as an in-place rewrite of a published record.
      <Tooltip
        key="edit"
        label={event.status === "geolocated" ? "Edit (saves a new version)" : "Edit"}
      >
        <Link
          href={eventEditHref(event.id)}
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
    sites.linkAction && <Fragment key="link-site">{sites.linkAction}</Fragment>,
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
    eventApprovals.answer && <Fragment key="approve">{eventApprovals.answer}</Fragment>,
    invited && (
      <InviteAnswerButtons
        key="invite"
        answer={(choice) => answerGeolocatorInvite(event.id, choice)}
        onAnswered={() => {
          setAnsweredFor(event.id);
          onChanged?.();
        }}
      />
    ),
    // `max-sm:pr-2`: the `?` grows its tap area 8px past its glyph on a phone, which stays inside
    // the row's right edge.
    canGeolocate && (
      <span key="geolocate" className="inline-flex items-center gap-1.5 max-sm:pr-2">
        <Link href={eventEditHref(event.id)} className={buttonClasses("primary")}>
          <ActionIcon action="geolocate" />
          Geolocate
        </Link>
        <FieldHelp concept="geolocate_request" />
      </span>
    ),
  ].filter(Boolean);

  return {
    panels: (event.hidden_at || invited || canReport) && (
      <>
        {event.hidden_at && <WithheldBanner since={event.hidden_at} noun="event" />}
        {invited && <GeolocatorInviteCard event={event} />}
        {canReport && report.panel}
      </>
    ),
    actions: {
      pinned: controls.length > 0 && (
        <div
          role="group"
          aria-label="Event actions"
          className="flex flex-wrap items-center justify-end gap-1.5"
        >
          {controls}
        </div>
      ),
      below: eventApprovals.summary,
    },
    sites: sites.block,
  };
}

/** One credited analyst. The reader's own row carries **Leave**, which takes their credit away,
 * so it arms in place: the first click turns the button into its confirm, and the second runs
 * it. */
function CreditRow({
  author,
  leave,
}: {
  author: { username: string; avatar_url?: string | null };
  leave?: { run: () => void; disabled: boolean };
}) {
  const { armed, trigger, controlRef } = useConfirmAction(() => leave?.run(), {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <AuthorByline author={author} avatar className="text-sm min-w-0" />
      {leave && (
        <Button
          action="leave"
          ref={controlRef}
          variant="danger"
          className={armed ? DANGER_CONFIRM : ""}
          onClick={trigger}
          disabled={leave.disabled}
        >
          {armed ? "Confirm leave" : "Leave"}
        </Button>
      )}
    </div>
  );
}

/**
 * The geolocators of a published event, owner first, as a co-geolocator reads them, with
 * **Leave** on their own row. Credit grants no edit right, so nothing else here acts on the
 * event.
 */
function GeolocatorsPanel({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const { user } = useAuth();
  const leave = useMutation((name: string) => removeGeolocator(event.id, name), {
    fallback: "Failed to update the geolocators",
    onSuccess: onChanged,
  });
  return (
    <div className="space-y-4">
      <div className="divide-y divide-neutral-800">
        {creditedAuthors(event).map((author) => (
          <CreditRow
            key={author.id}
            author={author}
            leave={
              author.username === user?.username
                ? { run: () => void leave.run(author.username), disabled: leave.loading }
                : undefined
            }
          />
        ))}
      </div>
      {leave.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {leave.error}
        </div>
      )}
    </div>
  );
}
