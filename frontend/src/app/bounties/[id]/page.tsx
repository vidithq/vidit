"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  claimBounty,
  closeBounty,
  deleteBounty,
  unclaimBounty,
} from "@/lib/bounties";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import type { BountyDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";

export default function BountyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: bounty,
    error: loadError,
    refetch,
  } = useApiResource<BountyDetail>(
    typeof params.id === "string" ? `/bounties/${params.id}` : null
  );
  // The three author/claim actions share one error + one pending flag, so each
  // mutation clears the others (mirrors the old single `setActionError(null)`).
  const toggleClaimMutation = useMutation(
    () => (isClaimedByMe ? unclaimBounty(bounty!.id) : claimBounty(bounty!.id)),
    { fallback: "Action failed", onSuccess: () => refetch() }
  );
  const closeMutation = useMutation(() => closeBounty(bounty!.id), {
    fallback: "Close failed",
    onSuccess: () => refetch(),
  });
  // `deleted` stays true through the post-delete navigation so the actions
  // don't re-enable in the unmount window (the row is gone; a second click
  // would 404). The old handler left its pending flag set instead of a finally.
  const [deleted, setDeleted] = useState(false);
  const deleteMutation = useMutation(() => deleteBounty(bounty!.id), {
    fallback: "Delete failed",
    onSuccess: () => {
      setDeleted(true);
      router.push("/bounties");
    },
  });

  const actionPending =
    toggleClaimMutation.loading ||
    closeMutation.loading ||
    deleteMutation.loading ||
    deleted;
  const actionError =
    toggleClaimMutation.error ?? closeMutation.error ?? deleteMutation.error;

  const error = loadError ?? actionError;

  if (error) {
    return (
      <PageError message={error} />
    );
  }
  if (!bounty) {
    return <PageLoading />;
  }

  const isAuthor = user?.id === bounty.author.id;
  const isClaimedByMe = !!user && bounty.claimers.some((c) => c.id === user.id);
  const canGeolocate = bounty.status === "requested";

  const handleToggleClaim = async () => {
    closeMutation.reset();
    deleteMutation.reset();
    await toggleClaimMutation.run();
  };

  const handleClose = async () => {
    if (!confirm("Close this bounty? Other analysts will no longer be able to geolocate it.")) {
      return;
    }
    toggleClaimMutation.reset();
    deleteMutation.reset();
    await closeMutation.run();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this bounty? This cannot be undone.")) return;
    toggleClaimMutation.reset();
    closeMutation.reset();
    await deleteMutation.run();
  };

  return (
    <PageShell
      back
      title={bounty.title}
      subtitle={<AuthorByline author={bounty.author} />}
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
                  {bounty.claimers.length > 0 ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end max-w-[400px]">
                      {bounty.claimers.map((c) => (
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
              <Button
                variant="secondary"
                onClick={handleToggleClaim}
                disabled={actionPending}
              >
                <Users size={14} />
                {isClaimedByMe ? "Stop signaling" : "I'm working on this"}
              </Button>
            )}
          </div>
        )}

        {isAuthor && bounty.status === "requested" && (
          <div className="pt-4 border-t border-neutral-800 flex items-center gap-4">
            <Button variant="ghost" onClick={handleClose} disabled={actionPending}>
              Close this bounty
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={actionPending}>
              Delete this bounty
            </Button>
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
