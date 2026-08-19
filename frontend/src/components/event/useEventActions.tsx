"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleX, History, MapPin, Pencil, Trash2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { deleteEvent, eventHistoryHref } from "@/lib/events";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
 *    flag, on the detail pages, because reading an event and passing it on or
 *    flagging it needs no standing in the row. The event page opens the row
 *    with the version history, a read like the others. The edit form carries
 *    none: sharing or reporting a draft one is in the middle of writing acts on
 *    a record that is not the one on screen. Neither does the map panel, whose
 *    job is to preview the row it is one click away from: actions belong to the
 *    page the title links to, not to a hover-sized preview of it.
 * 2. **The flow action**, at most one, filled: what this surface exists to move
 *    forward. Only an open request carries one (geolocate it).
 * 3. **Owner management**: the controls only the author holds, and each
 *    surface carries only its own, as icon buttons in the row like every other
 *    control in it. The event page carries editing a published geolocation,
 *    which files a revision rather than overwriting the record, as a pencil;
 *    the request page carries closing the request and deleting it, and the
 *    destructive one is red and confirms on a second click rather than hiding
 *    behind a disclosure. The two do not cross: `/events/{id}` serves a row of
 *    any status, so an unscoped owner tier put "Close this request" on the page
 *    for a row that is not a request at all.
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

// The grammar itself, one flag per tier per surface. The map panel and the edit
// form render nothing at all here: the panel previews a row whose page is one
// click away on the title, so its actions live there rather than in a preview of
// it, and the form's own flow action is its bottom submit while its utilities
// would act on a record the reader is currently rewriting. The event page has no
// flow action (a published geolocation is finished work) but does carry the
// correction its author makes.
//
// Owner management is two entries, not one, because the surfaces claim
// different halves of it: `revise` is correcting a published geolocation, which
// only the event page offers, and `dispose` is withdrawing or deleting a
// request, which only the request page offers. Each surface serves rows of
// several statuses, so the split is what keeps a request's verbs off the event
// page and back. `history` is the read into a published record's versions,
// public, first in the utilities row: the event page alone carries it, since
// the map panel and the forms show one version by construction.
const TIERS: Record<
  ActionSurface,
  {
    flow: boolean;
    revise: boolean;
    dispose: boolean;
    history: boolean;
    utilities: boolean;
  }
> = {
  event:   { flow: false, revise: true,  dispose: false, history: true,  utilities: true },
  request: { flow: true,  revise: false, dispose: true,  history: false, utilities: true },
  panel:   { flow: false, revise: false, dispose: false, history: false, utilities: false },
  edit:    { flow: false, revise: false, dispose: false, history: false, utilities: false },
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

  // Tier 3. Per surface, then per state. Every owner verb is an icon button in
  // the row, the shape the flow action and the utilities beside it already
  // take: the author's own controls are the ones they reach for most, and a
  // disclosure holding two entries costs a click on every use to hide what the
  // row has width for. What a destructive verb gets instead of a hiding place
  // is a colour and a second click.
  const canRevise = isAuthor && tiers.revise && event.status === "geolocated";
  const canClose = isAuthor && tiers.dispose && isOpenRequest;
  const canDelete =
    isAuthor && tiers.dispose && (isOpenRequest || event.status === "closed");

  // A surface whose every tier is off, or off for this row, gets nothing rather
  // than an empty row: the wrapper is itself an item in the host's own cluster,
  // so an empty one prints a gap beside the controls the host adds of its own
  // (the edit form's queue position, Skip and Reject).
  const rowIsEmpty =
    !tiers.utilities &&
    !(tiers.flow && isOpenRequest) &&
    !canRevise &&
    !canClose &&
    !canDelete;

  return {
    error,
    // `flex-wrap` plus `justify-end`: the row is wider than a phone, so it
    // breaks into stacked right-aligned lines instead of pushing the header
    // sideways (PageShell caps the cluster at the header width).
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
        {canRevise && (
          <Link
            href={`/events/${event.id}/edit`}
            className={buttonClasses("ghost", { icon: true })}
            aria-disabled={pending || undefined}
            // "Edit" alone would read as an in-place rewrite. The record is
            // corrected by adding a version, and the label says so.
            aria-label="Edit this geolocation"
            title="Edit this geolocation (files a new version)"
          >
            <Pencil size={14} />
          </Link>
        )}
        {canClose && (
          <Button
            icon
            variant="ghost"
            onClick={() => setClosing(true)}
            disabled={pending}
            aria-controls={CLOSE_FORM_ID}
            // The request is withdrawn, not deleted: the row stays readable
            // with its reason, so this is not the destructive verb and does not
            // wear the destructive colour.
            aria-label="Close this request"
            title="Close this request"
          >
            <CircleX size={14} />
          </Button>
        )}
        {canDelete && <DeleteRequestButton onDelete={deleteMutation.run} disabled={pending} />}
        {/* The utilities tier, one unit so it stays together when the row
            wraps: the history (event page only), the share pair, then the
            report flag, in that order. Reading surfaces only: a form carries
            the controls that finish the edit, not the ones that pass the
            record on. */}
        {tiers.utilities && (
          <div className="flex items-center gap-1.5">
            {/* The way into the record's history, first in the row. Public like
                the history itself: a corrected record is only auditable if any
                reader can walk the corrections, so it is not the owner's
                control. A published row is the only one with versions to walk,
                since every other state is edited in place. */}
            {tiers.history && event.status === "geolocated" && (
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

/**
 * Deleting a request: red, and it takes two clicks.
 *
 * The row is gone for good, so the guard is the two-click confirm every
 * point of no return on this site uses (`useConfirmAction`), not a browser
 * `confirm()` dialog: the second click lands on the same pixels as the first,
 * nothing is inserted and nothing moves, and the armed state is `DANGER_CONFIRM`
 * loud red, the one place that fill appears. It disarms on its own after
 * `ARM_MS`, on Escape, and on any click or focus landing elsewhere.
 *
 * An icon-only control has no visible label to flip, so the name and the
 * tooltip say what the next click does, and a sibling live region reports the
 * armed state for a reader who cannot see the colour.
 *
 * Its own component rather than a branch in the row: the arming is state, and
 * the hook that owns it cannot be called conditionally.
 */
function DeleteRequestButton({
  onDelete,
  disabled,
}: {
  onDelete: () => Promise<unknown>;
  disabled: boolean;
}) {
  const { armed, trigger, controlRef } = useConfirmAction(
    () => {
      void onDelete();
    },
    { timeoutMs: ARM_MS, dismissOnOutside: true }
  );
  const label = armed ? "Confirm delete" : "Delete this request";

  return (
    <>
      <Button
        ref={controlRef}
        icon
        variant="dangerGhost"
        className={armed ? DANGER_CONFIRM : ""}
        onClick={trigger}
        disabled={disabled}
        aria-label={label}
        title={armed ? "Confirm delete: this cannot be undone" : label}
      >
        <Trash2 size={14} />
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {armed ? "Click again to delete this request. This cannot be undone." : ""}
      </span>
    </>
  );
}
