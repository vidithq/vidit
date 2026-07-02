"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import DetectionCard from "@/components/event/DetectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type PaginatedEventDetails,
} from "@/lib/events";

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [page, setPage] = useState(1);

  // The list is the caller's own: the endpoint scopes to ``current_user`` and
  // ignores the URL username, so viewing it under another analyst's handle
  // would show your detections under their name. Send a non-owner to that
  // profile.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  const { data, error } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsPath(page) : null
  );

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  let listBody;
  if (error) {
    listBody = <p className="text-sm text-neutral-300">{error}</p>;
  } else if (!data) {
    listBody = <p className="text-sm text-neutral-500">Loading…</p>;
  } else if (data.items.length === 0) {
    listBody = (
      <EmptyState
        variant="plain"
        lead="No detections to submit."
        cta={
          <>
            <Link href="/submit?import=1" className={buttonClasses("primary")}>
              Import your work
            </Link>
            <Link href={`/profile/${username}`} className={`text-xs ${TEXT_LINK}`}>
              Back to profile
            </Link>
          </>
        }
      >
        New detections land here after you import your archive or tag the bot
        on a geolocation tweet.
      </EmptyState>
    );
  } else {
    const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));
    listBody = (
      <div className="space-y-3">
        {data.items.map((geo) => (
          <DetectionCard key={geo.id} geo={geo} />
        ))}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-xs text-neutral-500">
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span>
              Page {page} of {totalPages} · {data.total} pending
            </span>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
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
