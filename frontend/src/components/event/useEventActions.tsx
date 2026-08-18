"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@/hooks/useMutation";
import { deleteEvent } from "@/lib/events";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/OverflowMenu";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import ShareButtons from "@/components/event/ShareButtons";
import { useReportEvent } from "@/components/event/useReportEvent";
import type { EventDetail } from "@/types";

/**
 * The action grammar for one event, in one place: every detail surface calls
 * this and renders what it gets back, so no surface hand-assembles a row of its
 * own and the same control can't drift between them.
 *
 * Three tiers, always in this order, always in the surface's top-right slot
 * (`docs/design.md` → *Page chrome*):
 *
 * 1. **Utilities**, far right, icon-compact: the share pair plus the report
 *    flag. On every surface, because reading an event and passing it on or
 *    flagging it needs no standing in the row.
 * 2. **The flow action**, at most one, filled: what this surface exists to move
 *    forward. Only an open request carries one (geolocate it).
 * 3. **Owner management**, behind one `⋯` `<OverflowMenu>`: the controls only
 *    the author holds, and each surface carries only its own. The request page
 *    carries closing and deleting the request; the event page carries editing a
 *    published geolocation, which files a revision rather than overwriting the
 *    record. The two do not cross: `/events/{id}` serves a row of any status,
 *    so an unscoped owner tier put "Close this request" on the page for a row
 *    that is not a request at all.
 *
 * The hook returns nodes rather than rendering them, the shape `useReportEvent`
 * already uses, because the row and the panels its triggers open land in two
 * different slots: `actions` goes in `PageShell`'s `actions` (or the map
 * panel's byline row) and `panels` goes directly under the header, where the
 * trigger that opened it is. It is called before a surface's early returns,
 * with `event` null while the row loads, so the hook order is stable.
 */

/** Which surface is asking, which is what selects the tiers. */
export type ActionSurface = "event" | "request" | "panel" | "edit";

// The grammar itself. Utilities are unconditional, so only the gated tiers are
// listed: a surface with none (the map panel, the detection confirmation form,
// whose own flow action is the form's bottom submit) renders the utilities
// alone. The event page has no flow action (a published geolocation is finished
// work) but does carry the correction its author makes.
//
// Owner management is two entries, not one, because the surfaces claim
// different halves of it: `revise` is correcting a published geolocation, which
// only the event page offers, and `dispose` is withdrawing or deleting a
// request, which only the request page offers. Each surface serves rows of
// several statuses, so the split is what keeps a request's verbs off the event
// page and back.
const TIERS: Record<
  ActionSurface,
  { flow: boolean; revise: boolean; dispose: boolean }
> = {
  event: { flow: false, revise: true, dispose: false },
  request: { flow: true, revise: false, dispose: true },
  panel: { flow: false, revise: false, dispose: false },
  edit: { flow: false, revise: false, dispose: false },
};

// Ties the menu entry to the panel it opens two levels down the tree, which
// `aria-controls` needs since the two are not DOM siblings.
const CLOSE_FORM_ID = "close-request-form";

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
  /** A failed write from this row; the surface merges it with its load error. */
  error: string | null;
}

export function useEventActions({
  event,
  surface,
  onChanged,
}: EventActionsOptions): EventActions {
  const router = useRouter();
  const { user } = useAuth();
  // The report control is its own state machine (it works signed out and
  // outlives a surface's other actions), consumed here so the utilities tier is
  // assembled once.
  const report = useReportEvent(event?.id ?? "");
  // Whether the inline close panel is open.
  const [closing, setClosing] = useState(false);
  // `deleted` stays true through the post-delete navigation so the actions
  // don't re-enable in the unmount window (the row is gone; a second click
  // would 404).
  const [deleted, setDeleted] = useState(false);
  const deleteMutation = useMutation(() => deleteEvent(event!.id), {
    fallback: "Delete failed",
    onSuccess: () => {
      setDeleted(true);
      router.push("/requests");
    },
  });

  // Same leak the report form had: this hook survives a client navigation from
  // one request to the next, so per-event state has to follow the row rather
  // than the mount. Without it the next request opens with the previous one's
  // close panel open, or permanently disabled actions inherited from a delete
  // that already navigated away.
  useEffect(() => {
    // Guarded on a real id: `event` also goes null while a row loads and
    // during the post-delete navigation, and resetting `deleted` there would
    // re-enable the actions in exactly the unmount window it exists to cover.
    if (!event?.id) return;
    setClosing(false);
    setDeleted(false);
  }, [event?.id]);

  const pending = deleteMutation.loading || deleted;
  const error = deleteMutation.error;

  if (!event) return { actions: null, panels: null, error };

  const tiers = TIERS[surface];
  const isAuthor = user?.id === event.owner.id;
  const isOpenRequest = event.status === "requested";

  const handleDelete = async () => {
    if (!confirm("Delete this request? This cannot be undone.")) return;
    await deleteMutation.run();
  };

  // Tier 3. Per surface, then per state: the author corrects a published
  // geolocation on the event page, and on the request page closes a request
  // only while it is open and deletes one that is open or already closed.
  const ownerItems: OverflowMenuItem[] = [];
  if (isAuthor) {
    if (tiers.revise && event.status === "geolocated") {
      ownerItems.push({
        // "Edit" alone would read as an in-place rewrite. The record is
        // corrected by adding a version, and the entry says so.
        label: "Edit this geolocation",
        onClick: () => router.push(`/events/${event.id}/edit`),
        disabled: pending,
      });
    }
    if (tiers.dispose && isOpenRequest) {
      ownerItems.push({
        label: "Close this request",
        onClick: () => setClosing(true),
        controls: CLOSE_FORM_ID,
        disabled: pending,
      });
    }
    if (tiers.dispose && (isOpenRequest || event.status === "closed")) {
      ownerItems.push({
        label: "Delete this request",
        onClick: () => void handleDelete(),
        danger: true,
        disabled: pending,
      });
    }
  }

  return {
    error,
    // `flex-wrap` plus `justify-end`: the row is wider than a phone, so it
    // breaks into stacked right-aligned lines instead of pushing the header
    // sideways (PageShell caps the cluster at the header width).
    actions: (
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
        <OverflowMenu items={ownerItems} />
        {/* The utilities tier, one unit so it stays together when the row
            wraps: the share pair plus the report flag, in that order, on every
            surface. */}
        <div className="flex items-center gap-1.5">
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
      </div>
    ),
    // Both panels open directly under the header, where the triggers that
    // opened them are. They stack rather than replace each other: each is its
    // own titled card, so a reader who somehow opens both reads two separate
    // forms in a column, never two forms sharing a slot.
    panels: (
      <>
        {closing && (
          // The `id` sits on a wrapper, not the Card, so `aria-controls` on a
          // trigger that is not a DOM sibling still resolves (same shape the
          // report form uses).
          <div id={CLOSE_FORM_ID}>
            <Card as="section">
              <SectionEyebrow title="Close this request" margin="none" />
              <CloseEventForm
                eventId={event.id}
                status={event.status}
                disabled={pending}
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
