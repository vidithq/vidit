"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { skipBackRecord } from "@/lib/navigation";
import {
  detectionsReviewPath,
  type PaginatedEventDetails,
} from "@/lib/events";
import { detectionsQueueHref, eventEditHref, profileHref } from "@/lib/routes";

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
  const queueHref = detectionsQueueHref(username);

  // Same owner rule as the queue: the endpoint scopes to `current_user` and ignores the URL username.
  useEffect(() => {
    if (user && !isOwn) router.replace(profileHref(username));
  }, [user, isOwn, username, router]);

  const { data, error, refetch } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsReviewPath() : null
  );

  // An empty queue ends the pass on the queue list, which says so itself.
  useEffect(() => {
    if (!data) return;
    const first = data.items[0];
    // Not part of the walk: left in the back-stack, Back would redirect again.
    skipBackRecord();
    router.replace(first ? eventEditHref(first.id, true) : queueHref);
  }, [data, router, queueHref]);

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  return (
    <PageShell back backFallback={queueHref} title="Review detections">
      {error ? (
        <ErrorNotice error={error} onRetry={refetch} />
      ) : (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
    </PageShell>
  );
}
