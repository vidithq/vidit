"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  deleteEvent,
  investigateEvent,
  uninvestigateEvent,
} from "@/lib/events";
import { formatDate } from "@/lib/format";
import { loginNext } from "@/lib/navigation";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import ShareButtons from "@/components/event/ShareButtons";
import { useReportEvent } from "@/components/event/useReportEvent";
import type { EventDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

// Ties the header's Close trigger to the panel it opens two levels down the
// tree, which `aria-controls` needs since the two are not DOM siblings.
const CLOSE_FORM_ID = "close-request-form";

/**
 * A request is a ``requested`` event (see ``docs/data-model.md`` → ``events``),
 * served by the same ``GET /events/{id}`` a located row uses; this page just
 * renders the requested-only actions (geolocate / investigate / close / delete)
 * around the shared ``EventDetailBody``. Every one of them sits in PageShell's
 * ``actions`` slot, the same top-right cluster the event detail page and the
 * map side panel use, so a reader finds the controls in one place on all three
 * detail surfaces. Close captures a required free-text reason via
 * ``CloseEventForm``; the status badge tells a withdrawn request from a rejected
 * detection through ``before_closed_status``.
 */
export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const requestId = typeof params.id === "string" ? params.id : "";
  const {
    data: request,
    error: loadError,
    refetch,
  } = useApiResource<EventDetail>(
    requestId ? `/events/${requestId}` : null
  );
  // Same split as the event page: the red trigger joins the share row in the
  // header, the form opens under it. Before the early returns, as every hook
  // here must be.
  const report = useReportEvent(requestId);
  // Whether the inline close panel is open.
  const [closing, setClosing] = useState(false);
  // Optimistic "I'm working on this": flip locally on click so the button
  // reflects the toggle instantly (mirrors FollowButton), then refetch to
  // reconcile the "Working on" list. Null = follow the server value.
  const [optimisticInvestigating, setOptimisticInvestigating] = useState<
    boolean | null
  >(null);
  // The investigate + delete actions share one error + one pending flag, so
  // each mutation resets the other.
  const toggleInvestigateMutation = useMutation(
    (next: boolean) =>
      next ? investigateEvent(request!.id) : uninvestigateEvent(request!.id),
    {
      fallback: "Action failed",
      onSuccess: () => refetch(),
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
  const deleteMutation = useMutation(() => deleteEvent(request!.id), {
    fallback: "Delete failed",
    onSuccess: () => {
      setDeleted(true);
      router.push("/requests");
    },
  });

  const actionPending =
    toggleInvestigateMutation.loading ||
    deleteMutation.loading ||
    deleted;
  const actionError =
    toggleInvestigateMutation.error ?? deleteMutation.error;

  const error = loadError ?? actionError;

  if (error) {
    return (
      <PageError message={error} />
    );
  }
  if (!request) {
    return <PageLoading />;
  }

  const isAuthor = user?.id === request.owner.id;
  const serverInvestigatingMe =
    !!user && request.investigators.some((c) => c.id === user.id);
  // Optimistic value wins until the refetch lands and clears it.
  const isInvestigatingMe = optimisticInvestigating ?? serverInvestigatingMe;
  const canGeolocate = request.status === "requested";

  const handleToggleInvestigate = async () => {
    // Signalling requires an account; the request page is public, so the
    // proxy can't intercept. Route through login and land back here.
    if (!user) {
      router.push(loginNext(`/requests/${request!.id}`));
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

  return (
    <PageShell
      back
      title={request.title}
      subtitle={<AuthorByline author={request.owner} avatar />}
      actions={
        // Every way to act on this request lives in this one cluster, the same
        // top-right spot the event page and the map panel use. Reading order
        // runs from the main call to action to the quiet controls: geolocate,
        // signal, close, delete, share, report.
        //
        // `flex-wrap` plus `justify-end`: the row is wider than a phone, so it
        // breaks into stacked right-aligned lines instead of pushing the header
        // sideways (PageShell caps the cluster at the header width).
        //
        // A request is served by the same `GET /events/{id}` a located row is,
        // and `/events/{id}` renders it, so the share row needs nothing the
        // payload does not already carry: the coordinate pair is simply absent
        // and the tweet drops that line.
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {canGeolocate && (
            <Link
              href={`/submit?request_id=${request.id}`}
              className={buttonClasses("primary")}
            >
              <MapPin size={14} />
              Geolocate this
            </Link>
          )}
          {canGeolocate && !isAuthor && (
            // Active (signalling) reads as a filled, on state; the call to
            // action reads as a quieter outline, mirroring FollowButton's
            // variant swap so the toggle state is unambiguous.
            <Button
              variant={isInvestigatingMe ? "primary" : "secondary"}
              onClick={handleToggleInvestigate}
              disabled={actionPending}
              aria-pressed={isInvestigatingMe}
            >
              <Users size={14} />
              {isInvestigatingMe ? "Working on this" : "I'm working on this"}
            </Button>
          )}
          {isAuthor && request.status === "requested" && (
            // A toggle, like the report trigger beside it: the panel it opens
            // sits under the header, so the button that opened it stays put
            // and closes it again.
            <Button
              variant="ghost"
              onClick={() => setClosing((prev) => !prev)}
              disabled={actionPending}
              aria-expanded={closing}
              aria-controls={CLOSE_FORM_ID}
            >
              Close this request
            </Button>
          )}
          {isAuthor &&
            (request.status === "requested" || request.status === "closed") && (
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={actionPending}
              >
                Delete this request
              </Button>
            )}
          <ShareButtons
            id={request.id}
            title={request.title}
            author={request.owner.username}
            eventDate={request.event_date}
            lat={request.event_coords?.lat ?? null}
            lng={request.event_coords?.lng ?? null}
            status={request.status}
          />
          {report.trigger}
        </div>
      }
    >
        {/* Both panels open directly under the header, where the triggers that
            opened them are. They stack rather than replace each other: each is
            its own titled card, so a reader who somehow opens both reads two
            separate forms in a column, never two forms sharing a slot. */}
        {closing && (
          // The `id` sits on a wrapper, not the Card, so `aria-controls` on a
          // trigger that is not a DOM sibling still resolves (same shape the
          // report form uses).
          <div id={CLOSE_FORM_ID}>
            <Card as="section">
              <SectionEyebrow title="Close this request" margin="none" />
              <CloseEventForm
                eventId={request.id}
                status={request.status}
                disabled={actionPending}
                onClosed={() => {
                  setClosing(false);
                  refetch();
                }}
                onCancel={() => setClosing(false)}
              />
            </Card>
          </div>
        )}
        {report.panel}

        {/* A request is an event with no coordinates, so the body renders with
            an empty Location and the missing detected-from / requested-by rows
            simply drop out. Its two request-only rows slot in via detailExtras. */}
        <EventDetailBody
          geo={request}
          variant="page"
          detailExtras={
            <>
              {request.status === "requested" && (
                <DetailRow label="Working on" align="start">
                  {request.investigators.length > 0 ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end max-w-[400px]">
                      {request.investigators.map((c) => (
                        <Link
                          key={c.id}
                          href={`/profile/${c.username}`}
                          className={`text-sm ${TEXT_LINK}`}
                        >
                          @{c.username}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-neutral-600">—</span>
                  )}
                </DetailRow>
              )}
              {request.closed_at && (
                <DetailRow label="Closed" value={formatDate(request.closed_at)} />
              )}
            </>
          }
        />
    </PageShell>
  );
}
