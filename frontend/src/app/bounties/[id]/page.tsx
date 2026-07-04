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
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import type { EventDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";

/**
 * A bounty is a ``requested`` event (see ``docs/data-model.md`` → ``events``),
 * served by the same ``GET /events/{id}`` a located row uses; this page just
 * renders the requested-only actions (investigate / close) around the shared
 * ``EventDetailBody``. Close captures a required free-text reason via
 * ``CloseEventForm``; the status badge tells a withdrawn request from a rejected
 * detection through ``before_closed_status``.
 */
export default function BountyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: bounty,
    error: loadError,
    refetch,
  } = useApiResource<EventDetail>(
    typeof params.id === "string" ? `/events/${params.id}` : null
  );
  // Whether the inline close panel is open (replaces the old browser confirm +
  // fixed reason).
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
      next ? investigateEvent(bounty!.id) : uninvestigateEvent(bounty!.id),
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
  // would 404). The old handler left its pending flag set instead of a finally.
  const [deleted, setDeleted] = useState(false);
  const deleteMutation = useMutation(() => deleteEvent(bounty!.id), {
    fallback: "Delete failed",
    onSuccess: () => {
      setDeleted(true);
      router.push("/bounties");
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
  if (!bounty) {
    return <PageLoading />;
  }

  const isAuthor = user?.id === bounty.owner.id;
  const serverInvestigatingMe =
    !!user && bounty.investigators.some((c) => c.id === user.id);
  // Optimistic value wins until the refetch lands and clears it.
  const isInvestigatingMe = optimisticInvestigating ?? serverInvestigatingMe;
  const canGeolocate = bounty.status === "requested";

  const handleToggleInvestigate = async () => {
    deleteMutation.reset();
    const next = !isInvestigatingMe;
    setOptimisticInvestigating(next);
    const ok = await toggleInvestigateMutation.run(next);
    // On success the refetch reconciles the list; drop the optimistic override
    // so the fresh server value takes back over.
    if (ok !== undefined) setOptimisticInvestigating(null);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this bounty? This cannot be undone.")) return;
    toggleInvestigateMutation.reset();
    await deleteMutation.run();
  };

  return (
    <PageShell
      back
      title={bounty.title}
      subtitle={<AuthorByline author={bounty.owner} />}
    >
        {/* A bounty is an event with no coordinates, so the body renders with
            an empty Location and the missing detected-from / requested-by rows
            simply drop out. Its two bounty-only rows slot in via detailExtras. */}
        <EventDetailBody
          geo={bounty}
          variant="page"
          detailExtras={
            <>
              {bounty.status === "requested" && (
                <DetailRow label="Working on" align="start">
                  {bounty.investigators.length > 0 ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end max-w-[400px]">
                      {bounty.investigators.map((c) => (
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
              {bounty.closed_at && (
                <DetailRow label="Closed" value={formatDate(bounty.closed_at)} />
              )}
            </>
          }
        />

        {/* Actions at the bottom, after the user has read the bounty.
            "I'm working on this" gets a neutral treatment so it doesn't
            compete with the "Geolocate this" CTA. */}
        {canGeolocate && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-3 flex-wrap">
            <Link
              href={`/submit?bounty_id=${bounty.id}`}
              className={buttonClasses("primary")}
            >
              <MapPin size={14} />
              Geolocate this
            </Link>
            {!isAuthor && (
              // Active (signalling) reads as a filled, on state; the call-to-
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
          </div>
        )}

        {isAuthor && bounty.status === "requested" && (
          <div className="pt-4 border-t border-neutral-800 space-y-4">
            {closing ? (
              <CloseEventForm
                eventId={bounty.id}
                status={bounty.status}
                disabled={actionPending}
                onClosed={() => {
                  setClosing(false);
                  refetch();
                }}
                onCancel={() => setClosing(false)}
              />
            ) : (
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  onClick={() => setClosing(true)}
                  disabled={actionPending}
                >
                  Close this bounty
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={actionPending}
                >
                  Delete this bounty
                </Button>
              </div>
            )}
          </div>
        )}
        {isAuthor && bounty.status === "closed" && (
          <div className="pt-4 border-t border-neutral-800">
            <Button variant="danger" onClick={handleDelete} disabled={actionPending}>
              Delete this bounty
            </Button>
          </div>
        )}
    </PageShell>
  );
}
