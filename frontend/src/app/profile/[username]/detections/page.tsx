"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import DetectionCard from "@/components/geolocation/DetectionCard";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type PaginatedGeolocationDetails,
} from "@/lib/geolocations";

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [page, setPage] = useState(1);
  const { refresh: refreshDetectionCount } = useDetectionsCount();

  // The list is the caller's own: the endpoint scopes to ``current_user`` and
  // ignores the URL username, so viewing it under another analyst's handle
  // would show your detections under their name. Send a non-owner to that
  // profile.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  const { data, error, refetch } = useApiResource<PaginatedGeolocationDetails>(
    isOwn ? detectionsPath(page) : null
  );

  if (authLoading || !user || !isOwn) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
  }

  // A row leaves the list once acted on (submitted then frozen, rejected then
  // soft-deleted). Acting on the last row of a later page would strand the user
  // on an empty page, step back instead of refetching into nothing.
  const handleActed = () => {
    // Keep the sidebar dot + profile entry in sync with the list.
    refreshDetectionCount();
    if (data && data.items.length === 1 && page > 1) {
      setPage((p) => p - 1);
    } else {
      refetch();
    }
  };

  let listBody;
  if (error) {
    listBody = <p className="text-sm text-neutral-300">{error}</p>;
  } else if (!data) {
    listBody = <p className="text-sm text-neutral-500">Loading…</p>;
  } else if (data.items.length === 0) {
    listBody = (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm text-neutral-400">No detections to submit.</p>
        <p className="text-xs text-neutral-500">
          New detections land here after you import your archive or tag the bot
          on a geolocation tweet.
        </p>
        <div className="flex flex-col items-center gap-2 pt-1">
          <Link
            href="/submit?import=1"
            className={`px-5 py-2.5 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
          >
            Import your work
          </Link>
          <Link
            href={`/profile/${username}`}
            className="text-xs text-orange-400 hover:underline"
          >
            Back to profile
          </Link>
        </div>
      </div>
    );
  } else {
    const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));
    listBody = (
      <div className="space-y-3">
        {data.items.map((geo) => (
          <DetectionCard key={geo.id} geo={geo} onActed={handleActed} />
        ))}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-xs text-neutral-500">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-md border border-neutral-700 hover:bg-neutral-800 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages} · {data.total} pending
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md border border-neutral-700 hover:bg-neutral-800 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <PageShell
      back
      title="Detections"
      subtitle="Machine-detected geolocations awaiting your submission. Edit and submit, or reject each."
    >
      {listBody}
    </PageShell>
  );
}
