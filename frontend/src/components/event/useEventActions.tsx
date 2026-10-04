"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleX, History, MapPin, Pencil } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { COLLECTABLE_STATUSES, CollectionIcon } from "@/lib/collections";
import { eventHistoryHref, hasPublishedRecord } from "@/lib/events";
import { AddToCollectionPanel } from "@/components/collections/AddToCollectionPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { closeActionLabel, CloseEventForm } from "@/components/event/CloseEventForm";
import ShareButtons from "@/components/event/ShareButtons";
import { useReportContent } from "@/components/report/useReportContent";
import type { EventDetail } from "@/types";

/**
 * The action grammar for one event: every detail surface calls this and renders what it gets back,
 * so no surface hand-assembles a row and controls can't drift between them.
 *
 * Three tiers, in this order, in the surface's top-right slot (`docs/design.md`, Page chrome):
 *
 * 1. **Utilities**, far right, icon-compact: the share pair plus the report flag on the detail
 *    pages. The event page opens the row with the version history. The edit form carries none
 *    (they would act on a record other than the one on screen), nor does the map panel (actions
 *    belong to the page its title links to).
 * 2. **The flow action**, at most one, filled. Only an open request carries one (geolocate it).
 * 3. **Owner management**, icon buttons only the author holds: editing an open request
 *    (overwrites it) on both detail pages; on the event page also shelving the row on one of the
 *    author's collections (writes no version) and editing a published geolocation (files a
 *    version); on both pages closing the row, which is how an author takes work back. Nothing here
 *    destroys a row: closing keeps it readable with its reason, and removal is an admin act.
 *
 * The hook returns nodes rather than rendering them (like `useReportContent`) because the row and
 * the panels its triggers open land in different slots: `actions` goes in `PageShell`'s `actions`
 * (or the map panel's byline row), `panels` directly under the header. Called before a surface's
 * early returns, with `event` null while the row loads, so hook order is stable.
 */

/** Which surface is asking, which is what selects the tiers. */
export type ActionSurface = "event" | "request" | "panel" | "edit";

// The grammar: one flag per tier per surface. The map panel and edit form render nothing here (the
// panel previews a row whose page is one click away; the form's flow action is its submit and its
// utilities would act on a record being rewritten). The event page has no flow action but carries
// the correction its author makes.
//
// Owner management is four entries because surfaces claim different parts: `collect` (shelve on
// one of the author's collections, event page only), `editRequest` (correct an open request, both
// detail pages), `saveVersion` (correct a published geolocation, event page only), `close` (take
// a row back, both detail pages). The two edits never appear together (no row is both requested
// and published) and lead to one edit address. Per-status offers are decided below, so a surface
// never offers a close to a row that cannot take one. `history` is the public read into a
// published record's versions, first in the utilities row, event page only.
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
  }
> = {
  event:   { flow: false, collect: true,  editRequest: true,  saveVersion: true,  close: true,  history: true,  utilities: true },
  request: { flow: true,  collect: false, editRequest: true,  saveVersion: false, close: true,  history: false, utilities: true },
  panel:   { flow: false, collect: false, editRequest: false, saveVersion: false, close: false, history: false, utilities: false },
  edit:    { flow: false, collect: false, editRequest: false, saveVersion: false, close: false, history: false, utilities: false },
};

// Ties the menu entry to the panel it opens (`aria-controls`; they are not DOM siblings).
const CLOSE_FORM_ID = "close-request-form";
const COLLECT_PANEL_ID = "add-to-collection-panel";

export interface EventActionsOptions {
  /** The row to act on. Null while it loads: both nodes come back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (close). */
  onChanged?: () => void;
}

export interface EventActions {
  /** The three-tier row, for the surface's top-right slot. */
  actions: ReactNode;
  /** The panels the row's triggers open, for the body under the header. */
  panels: ReactNode;
}

export function useEventActions({
  event,
  surface,
  onChanged,
}: EventActionsOptions): EventActions {
  const { user } = useAuth();
  // The report control is its own state machine (works signed out, outlives other actions),
  // consumed here so the utilities tier is assembled once.
  const report = useReportContent("event", event?.id ?? "");
  const [closing, setClosing] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // This hook survives a client navigation between rows, so per-event state follows the row, not
  // the mount: otherwise the next row opens with the previous one's close panel open.
  useEffect(() => {
    setClosing(false);
    setCollecting(false);
  }, [event?.id]);

  if (!event) return { actions: null, panels: null };

  const tiers = TIERS[surface];
  const isAuthor = user?.id === event.owner.id;
  const isOpenRequest = event.status === "requested";

  // Tier 3. Every owner verb is an icon button in the row, like the flow action and utilities beside
  // it: a disclosure for two entries would cost a click on every use.
  // The owner's edit of an open request. Owner-only, unlike geolocate: anyone may answer a request,
  // only the asker rewrites the question. It overwrites the row rather than filing a version, so
  // the label promises none.
  const canEditRequest = isAuthor && tiers.editRequest && isOpenRequest;
  const canSaveVersion = isAuthor && tiers.saveVersion && event.status === "geolocated";
  // Every live state closes, `geolocated` included: a claim its author no longer stands behind is
  // retracted, not left standing or destroyed. `closed` is terminal, so the verb disappears.
  const canClose = isAuthor && tiers.close && event.status !== "closed";
  const closeLabel = closeActionLabel(event.status);
  // Shelving the row on one of the owner's collections. The two worked statuses only, the set a
  // collection may hold (`services/event_filters.collectable_events`): a request is an ask and a
  // closed row was taken back, so the control is absent rather than offered and refused.
  const canCollect =
    isAuthor && tiers.collect && COLLECTABLE_STATUSES.includes(event.status);

  // A surface whose tiers are all off, or off for this row, gets nothing rather than an empty row:
  // the wrapper is an item in the host's cluster, so an empty one prints a gap beside the host's
  // own controls.
  const rowIsEmpty =
    !tiers.utilities &&
    !(tiers.flow && isOpenRequest) &&
    !canCollect &&
    !canEditRequest &&
    !canSaveVersion &&
    !canClose;

  return {
    // `flex-wrap` plus `justify-end`: the row is wider than a phone, so it breaks into right-aligned
    // lines instead of pushing the header sideways (PageShell caps the cluster at the header width).
    actions: rowIsEmpty ? null : (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {tiers.flow && isOpenRequest && (
          <Link
            href={`/submit?request_id=${event.id}`}
            className={buttonClasses("primary")}
          >
            <MapPin size={14} />
            Geolocate
          </Link>
        )}
        {canCollect && (
          <Button
            icon
            variant="ghost"
            onClick={() => setCollecting((open) => !open)}
            aria-controls={COLLECT_PANEL_ID}
            aria-expanded={collecting}
            aria-label="Add to collection"
            title="Add to collection"
            // The open trigger wears the active-row paint so the reader sees which control the panel belongs
            // to. A toggle, since the panel writes on every click inside it and there is nothing to cancel.
            className={collecting ? ACCENT_SURFACE : ""}
          >
            <CollectionIcon size={14} />
          </Button>
        )}
        {canEditRequest && (
          <Link
            href={`/events/${event.id}/edit`}
            className={buttonClasses("ghost", { icon: true })}
            // The same address the published correction uses; the label names the row, not the write: editing
            // a request overwrites it, so no version is promised.
            aria-label="Edit this request"
            title="Edit this request"
          >
            <Pencil size={14} />
          </Link>
        )}
        {canSaveVersion && (
          <Link
            href={`/events/${event.id}/edit`}
            className={buttonClasses("ghost", { icon: true })}
            // "Edit" alone would read as an in-place rewrite; the record is corrected by adding a version.
            aria-label="Edit this geolocation"
            title="Edit this geolocation (saves a new version)"
          >
            <Pencil size={14} />
          </Link>
        )}
        {canClose && (
          <Button
            icon
            variant="ghost"
            onClick={() => setClosing(true)}
            aria-controls={CLOSE_FORM_ID}
            // The row is taken back, not deleted: it stays readable with its reason, so this verb is not
            // destructive and doesn't wear the destructive colour. One verb closes every shape.
            aria-label={closeLabel}
            title={closeLabel}
          >
            <CircleX size={14} />
          </Button>
        )}
        {/* The utilities tier, one unit so it stays together when the row wraps: history (event page
            only), the share pair, then the report flag. Reading surfaces only: a form carries the controls
            that finish the edit. */}
        {tiers.utilities && (
          <div className="flex items-center gap-1.5">
            {/* The way into the record's history, first in the row. Public, since a corrected record is only
                auditable if any reader can walk the corrections. Only a published row has versions (other
                states are edited in place). */}
            {tiers.history && hasPublishedRecord(event) && (
              <Link
                href={eventHistoryHref(event.id)}
                className={buttonClasses("ghost", { icon: true })}
                aria-label="Version history"
                title="Version history"
              >
                <History size={14} />
              </Link>
            )}
            <ShareButtons
              id={event.id}
              title={event.title}
              author={event.owner.username}
              eventDate={event.event_date}
              lat={event.event_coords?.lat ?? null}
              lng={event.event_coords?.lng ?? null}
              status={event.status}
            />
            {report.trigger}
          </div>
        )}
      </div>
    ),
    // Both panels open directly under the header, where their triggers are. They stack rather than
    // replace each other: each is its own titled card.
    panels: (
      <>
        {canCollect && collecting && (
          <div id={COLLECT_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Add to collection" margin="none" />
              <AddToCollectionPanel eventId={event.id} />
            </Card>
          </div>
        )}
        {closing && (
          // The `id` sits on a wrapper, not the Card, so `aria-controls` on a non-sibling trigger still
          // resolves (same shape as the report form).
          <div id={CLOSE_FORM_ID}>
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
          </div>
        )}
        {report.panel}
      </>
    ),
  };
}
