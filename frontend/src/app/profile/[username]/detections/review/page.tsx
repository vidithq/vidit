"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { DetectionReview } from "@/components/detections/DetectionReview";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { useTaxonomy } from "@/components/geolocations/TaxonomyFields";
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
 */
export default function DetectionReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;

  // Same owner rule as the queue: the endpoint scopes to `current_user` and
  // ignores the URL username, so a non-owner would review their own drafts
  // under someone else's handle.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  const { data, error, refetch } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsReviewPath() : null
  );
  const taxonomy = useTaxonomy();

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  let body;
  if (error) {
    body = <p className="text-sm text-neutral-300">{error}</p>;
  } else if (!data) {
    body = <p className="text-sm text-neutral-500">Loading…</p>;
  } else {
    body = (
      <DetectionReview
        drafts={data.items}
        total={data.total}
        curatedTags={taxonomy.curatedTags}
        conflicts={taxonomy.conflicts}
        queueHref={`/profile/${username}/detections`}
        onReload={refetch}
      />
    );
  }

  return (
    <PageShell
      back
      backFallback={`/profile/${username}/detections`}
      title="Review detections"
      subtitle="Check the evidence, place the point, pick the conflict and capture source. Publishing freezes the row."
    >
      {taxonomy.curatedTagsError && (
        <CuratedTagsError
          onRetry={taxonomy.reloadCuratedTags}
          message="Couldn't load the Capture source options."
        />
      )}
      {taxonomy.conflictsError && (
        <CuratedTagsError
          onRetry={taxonomy.reloadConflicts}
          message="Couldn't load the Conflict options."
        />
      )}
      {body}
    </PageShell>
  );
}
