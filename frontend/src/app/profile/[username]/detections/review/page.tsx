"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { skipBackRecord } from "@/lib/navigation";
import {
  detectionsReviewPath,
  draftEditPath,
  type PaginatedEventDetails,
} from "@/lib/events";

/**
 * The entry to a review pass: `/profile/{username}/detections/review` opens the
 * first draft of the queue and hands the walk over to that draft's own URL.
 *
 * A pass lives on the edit route, one address per draft, so this page holds no
 * state of its own. It stays as the entry because it is the link the queue's
 * *Start reviewing* and any kept bookmark point at, and it always resolves to
 * whatever is at the head of the queue now. It leaves no trace behind it: the
 * history entry is replaced, and `skipBackRecord` keeps the route out of the
 * back-stack, so both the browser's Back and the header arrow reach the page
 * that opened the pass instead of running this redirect again.
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

  const { data, error } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsReviewPath() : null
  );

  // An empty queue has nothing to open, so the pass ends where it would have
  // ended: the queue list, which says so itself.
  useEffect(() => {
    if (!data) return;
    const first = data.items[0];
    // This route resolves and hands over, so it is no part of the walk: the
    // back arrow must reach the page that opened it. Left in the back-stack it
    // would redirect again and land back on the draft the reader is trying to
    // leave.
    skipBackRecord();
    router.replace(first ? draftEditPath(first.id, true) : queueHref);
  }, [data, router, queueHref]);

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
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
