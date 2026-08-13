"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { deleteEvent } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { CloseEventForm } from "@/components/event/CloseEventForm";
import type { EventDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Button, buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";

/**
 * A request is a ``requested`` event (see ``docs/data-model.md`` → ``events``),
 * served by the same ``GET /events/{id}`` a located row uses; this page just
 * renders the requested-only actions (geolocate / close) around the shared
 * ``EventDetailBody``. Close captures a required free-text reason via
 * ``CloseEventForm``; the status badge tells a withdrawn request from a rejected
 * detection through ``before_closed_status``.
 */
export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: request,
    error: loadError,
    refetch,
  } = useApiResource<EventDetail>(
    typeof params.id === "string" ? `/events/${params.id}` : null
  );
  // Whether the inline close panel is open.
  const [closing, setClosing] = useState(false);
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

  const actionPending = deleteMutation.loading || deleted;

  const error = loadError ?? deleteMutation.error;

  if (error) {
    return (
      <PageError message={error} />
    );
  }
  if (!request) {
    return <PageLoading />;
  }

  const isAuthor = user?.id === request.owner.id;
  const canGeolocate = request.status === "requested";

  const handleDelete = async () => {
    if (!confirm("Delete this request? This cannot be undone.")) return;
    await deleteMutation.run();
  };

  return (
    <PageShell
      back
      title={request.title}
      subtitle={<AuthorByline author={request.owner} avatar />}
    >
        {/* A request is an event with no coordinates, so the body renders with
            an empty Location and the missing detected-from / requested-by rows
            simply drop out. Its request-only row slots in via detailExtras. */}
        <EventDetailBody
          geo={request}
          variant="page"
          detailExtras={
            request.closed_at ? (
              <DetailRow label="Closed" value={formatDate(request.closed_at)} />
            ) : null
          }
        />

        {/* Action at the bottom, after the user has read the request. */}
        {canGeolocate && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-3 flex-wrap">
            <Link
              href={`/submit?request_id=${request.id}`}
              className={buttonClasses("primary")}
            >
              <MapPin size={14} />
              Geolocate this
            </Link>
          </div>
        )}

        {isAuthor && request.status === "requested" && (
          <div className="pt-4 border-t border-neutral-800 space-y-4">
            {closing ? (
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
            ) : (
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  onClick={() => setClosing(true)}
                  disabled={actionPending}
                >
                  Close this request
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={actionPending}
                >
                  Delete this request
                </Button>
              </div>
            )}
          </div>
        )}
        {isAuthor && request.status === "closed" && (
          <div className="pt-4 border-t border-neutral-800">
            <Button variant="danger" onClick={handleDelete} disabled={actionPending}>
              Delete this request
            </Button>
          </div>
        )}
    </PageShell>
  );
}
