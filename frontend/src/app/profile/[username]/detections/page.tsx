"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { buttonClasses } from "@/components/ui/Button";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type DetectionReadiness,
  type PaginatedEventDetails,
} from "@/lib/events";
import { detectionsQueueHref, profileHref } from "@/lib/routes";
import type { EventDetail } from "@/types";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The queue's one filter, answered by the server over the whole queue (not just the loaded rows). */
const FILTERS: { value: DetectionReadiness; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "incomplete", label: "Incomplete" },
];

/** The empty line per filter, naming the set that came back empty. */
const NOTHING_HERE: Record<DetectionReadiness, string> = {
  all: "Nothing left to review.",
  ready: "No ready detections.",
  incomplete: "No incomplete detections.",
};

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<DetectionReadiness>("all");

  // The endpoint scopes to `current_user` and ignores the URL username: send a non-owner to their own profile.
  useEffect(() => {
    if (user && !isOwn) router.replace(profileHref(username));
  }, [user, isOwn, username, router]);

  // The filter rides in the path, so a pick refetches server-side instead of hiding rows.
  const { data, error, refetch } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsPath(page, undefined, filter) : null
  );

  // The server pages by number, so the list appends each page as it lands, keyed by the filter
  // and the page it answers: page 1 of a filter starts the rows over.
  const [loaded, setLoaded] = useState<{
    key: string;
    rows: EventDetail[];
    summary: PaginatedEventDetails | null;
  }>({ key: "", rows: [], summary: null });
  const pageKey = `${filter}:${page}`;
  if (data && loaded.key !== pageKey) {
    setLoaded({
      key: pageKey,
      rows: page === 1 ? data.items : [...loaded.rows, ...data.items],
      summary: data,
    });
  }

  // A filter change restarts the walk: a page index from one filter can land past the end of another.
  const pick = (next: DetectionReadiness) => {
    setFilter(next);
    setPage(1);
  };

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  const reviewHref = `${detectionsQueueHref(username)}/review`;

  const summary = loaded.summary;
  let listBody;
  if (page === 1 && error) {
    listBody = (
      <ErrorNotice error={error} />
    );
  } else if (!summary || (page === 1 && !data)) {
    listBody = <p className="text-sm text-neutral-500">Loading…</p>;
  } else if (summary.ready_total + summary.incomplete_total === 0) {
    // Reached once the last detection is submitted: nothing links here while the queue is empty.
    listBody = <EmptyState variant="boxed">{NOTHING_HERE.all}</EmptyState>;
  } else {
    const { rows } = loaded;
    const loadingMore = page > 1 && !data && !error;
    listBody = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* The `?` beside the bar explains Ready and Incomplete. */}
          <span className="inline-flex items-center gap-1.5">
            <SegmentedControl
              options={FILTERS}
              value={filter}
              onChange={pick}
              aria-label="Filter the queue"
            />
            <FieldHelp concept="detection_queue_filter" />
          </span>
          {/* The whole queue split in two, under every filter and page. */}
          <span className="text-xs text-neutral-500">
            {summary.ready_total} ready · {summary.incomplete_total} incomplete
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState variant="boxed">{NOTHING_HERE[filter]}</EmptyState>
        ) : (
          <div className="space-y-2">
            {rows.map((detection) => (
              <DetectionQueueRow key={detection.id} detection={detection} />
            ))}
          </div>
        )}

        {rows.length < summary.total && (
          // Describes the filtered set the walk pages over.
          <p className="text-center text-xs text-neutral-500">
            {rows.length} of {summary.total} {filter === "all" ? "pending" : filter}
          </p>
        )}
        <LoadMoreRow
          walk={{
            hasMore: rows.length < summary.total,
            loadingMore,
            error: page > 1 ? error : null,
            // A failed page retries itself; otherwise the next page.
            loadMore: () => (error ? refetch() : setPage((p) => p + 1)),
          }}
        />
      </div>
    );
  }

  return (
    <PageShell
      back
      title="Detections"
      subtitle="Detections awaiting a pass. Open a row to work on it, or review them one after another on the same form."
      actions={
        summary && summary.ready_total + summary.incomplete_total > 0 ? (
          <Link href={reviewHref} className={buttonClasses("primary")}>
            Start reviewing
          </Link>
        ) : undefined
      }
    >
      {listBody}
    </PageShell>
  );
}
