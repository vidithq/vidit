"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { skipBackRecord } from "@/lib/navigation";
import {
  detectionsReviewPath,
  detectionEditPath,
  type PaginatedEventDetails,
} from "@/lib/events";

/**
 * Entry to a review pass: opens the first detection of the queue and hands the
 * walk to that detection's edit URL. The history entry is replaced and
 * `skipBackRecord` keeps this redirect out of the back-stack.
 */
export default function DetectionReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const queueHref = `/profile/${username}/detections`;

  // Same owner rule as the queue: the endpoint scopes to `current_user` and ignores the URL username.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  const { data, error } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsReviewPath() : null
  );

  // An empty queue ends the pass on the queue list, which says so itself.
  useEffect(() => {
    if (!data) return;
    const first = data.items[0];
    // Not part of the walk: left in the back-stack, Back would redirect again.
    skipBackRecord();
    router.replace(first ? detectionEditPath(first.id, true) : queueHref);
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
