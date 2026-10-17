"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type DetectionReadiness,
  type PaginatedEventDetails,
} from "@/lib/events";
import { detectionsQueueHref, profileHref } from "@/lib/routes";

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
  const { data, error } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsPath(page, undefined, filter) : null
  );

  // A filter change restarts the walk: a page index from one filter can land past the end of another.
  const pick = (next: DetectionReadiness) => {
    setFilter(next);
    setPage(1);
  };

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  const reviewHref = `${detectionsQueueHref(username)}/review`;

  let listBody;
  if (error) {
    listBody = <p className="text-sm text-neutral-300">{error}</p>;
  } else if (!data) {
    listBody = <p className="text-sm text-neutral-500">Loading…</p>;
  } else if (data.ready_total + data.incomplete_total === 0) {
    // Reached once the last detection is submitted: nothing links here while the queue is empty.
    listBody = <EmptyState variant="boxed">{NOTHING_HERE.all}</EmptyState>;
  } else {
    const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));
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
            {data.ready_total} ready · {data.incomplete_total} incomplete
          </span>
        </div>

        {data.items.length === 0 ? (
          <EmptyState variant="boxed">{NOTHING_HERE[filter]}</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.items.map((detection) => (
              <DetectionQueueRow key={detection.id} detection={detection} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-xs text-neutral-500">
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            {/* Both figures describe the filtered set the pager walks. */}
            <span>
              Page {page} of {totalPages} · {data.total}{" "}
              {filter === "all" ? "pending" : filter}
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
      subtitle="Detections awaiting a pass. Open a row to work on it, or review them one after another on the same form."
      actions={
        data && data.ready_total + data.incomplete_total > 0 ? (
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
