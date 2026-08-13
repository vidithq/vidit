"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { DetectionReview } from "@/components/detections/DetectionReview";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsReviewPath,
  type PaginatedEventDetails,
} from "@/lib/events";

/**
 * The focused review flow: `/profile/{username}/detections/review`, one draft
 * at a time. A route of its own rather than a mode on the queue, so it is a
 * link an analyst can keep and the browser's Back leaves it for the queue.
 *
 * The draft itself renders on the shared edit surface, which owns its own
 * header; this page's shell covers the states where there is no draft to show.
 */
export default function DetectionReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const queueHref = `/profile/${username}/detections`;

  // Same owner rule as the queue: the endpoint scopes to `current_user` and
  // ignores the URL username, so a non-owner would review their own drafts
  // under someone else's handle.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  const { data, error, refetch } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsReviewPath() : null
  );

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  if (data && !error) {
    return (
      <DetectionReview
        drafts={data.items}
        total={data.total}
        queueHref={queueHref}
        onReload={refetch}
      />
    );
  }

  return (
    <PageShell back backFallback={queueHref} title="Review detections">
      {error ? (
        <p className="text-sm text-neutral-300">{error}</p>
      ) : (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
    </PageShell>
  );
}
