"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@/hooks/useMutation";
import {
  deleteEvent,
  investigateEvent,
  uninvestigateEvent,
} from "@/lib/events";
import { loginNext } from "@/lib/navigation";
import { Button, buttonClasses } from "@/components/ui/Button";
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
 *    forward. Only an open request carries one (geolocate it, or signal that
 *    you are working on it).
 * 3. **Owner management**, behind one `⋯` `<OverflowMenu>`: the controls only
 *    the author holds. Only the request page carries any.
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

// The grammar itself. Utilities are unconditional, so only the two gated tiers
// are listed: a surface that is a reading surface (a geolocated event, the map
// panel, the detection confirmation form, whose own flow action is the form's
// bottom submit) renders neither.
const TIERS: Record<ActionSurface, { flow: boolean; owner: boolean }> = {
  event: { flow: false, owner: false },
  request: { flow: true, owner: true },
  panel: { flow: false, owner: false },
  edit: { flow: false, owner: false },
};

// Ties the menu entry to the panel it opens two levels down the tree, which
// `aria-controls` needs since the two are not DOM siblings.
const CLOSE_FORM_ID = "close-request-form";

export interface EventActionsOptions {
  /** The row to act on. Null while it loads: both nodes come back null. */
  event: EventDetail | null;
  surface: ActionSurface;
  /** Runs after a write that changes the row (the investigate toggle, close). */
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
  // Optimistic "I'm working on this": flip locally on click so the button
  // reflects the toggle instantly (mirrors FollowButton), then let the surface
  // refetch to reconcile the "Working on" list. Null = follow the server value.
  const [optimisticInvestigating, setOptimisticInvestigating] = useState<
    boolean | null
  >(null);
  // The investigate + delete actions share one error + one pending flag, so
  // each mutation resets the other.
  const toggleInvestigateMutation = useMutation(
    (next: boolean) =>
      next ? investigateEvent(event!.id) : uninvestigateEvent(event!.id),
    {
      fallback: "Action failed",
      onSuccess: () => onChanged?.(),
      // Roll the optimistic flip back to the server value on failure.
      onError: (err) => {
        setOptimisticInvestigating(null);
        return err instanceof Error ? err.message : undefined;
      },
    }
  );
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

  const pending =
    toggleInvestigateMutation.loading || deleteMutation.loading || deleted;
  const error = toggleInvestigateMutation.error ?? deleteMutation.error;

  if (!event) return { actions: null, panels: null, error };

  const tiers = TIERS[surface];
  const isAuthor = user?.id === event.owner.id;
  const isOpenRequest = event.status === "requested";
  const serverInvestigatingMe =
    !!user && event.investigators.some((c) => c.id === user.id);
  // Optimistic value wins until the refetch lands and clears it.
  const isInvestigatingMe = optimisticInvestigating ?? serverInvestigatingMe;

  const handleToggleInvestigate = async () => {
    // Signalling requires an account; the request page is public, so the
    // proxy can't intercept. Route through login and land back here.
    if (!user) {
      router.push(loginNext(`/requests/${event.id}`));
      return;
    }
    deleteMutation.reset();
    const next = !isInvestigatingMe;
    setOptimisticInvestigating(next);
    const ok = await toggleInvestigateMutation.run(next);
    // On success the refetch reconciles the list; drop the optimistic override
    // so the fresh server value takes back over.
    if (ok !== undefined) setOptimisticInvestigating(null);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this request? This cannot be undone.")) return;
    toggleInvestigateMutation.reset();
    await deleteMutation.run();
  };

  // Tier 3. Exactly today's visibility: the author closes a request only while
  // it is open, and deletes one that is open or already closed.
  const ownerItems: OverflowMenuItem[] = [];
  if (tiers.owner && isAuthor) {
    if (isOpenRequest) {
      ownerItems.push({
        label: "Close this request",
        onClick: () => setClosing(true),
        controls: CLOSE_FORM_ID,
        disabled: pending,
      });
    }
    if (isOpenRequest || event.status === "closed") {
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
        {tiers.flow && isOpenRequest && !isAuthor && (
          // Active (signalling) reads as a filled, on state; the call to
          // action reads as a quieter outline, mirroring FollowButton's
          // variant swap so the toggle state is unambiguous.
          <Button
            variant={isInvestigatingMe ? "primary" : "secondary"}
            onClick={handleToggleInvestigate}
            disabled={pending}
            aria-pressed={isInvestigatingMe}
          >
            <Users size={14} />
            {isInvestigatingMe ? "Investigating" : "Investigate"}
          </Button>
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
