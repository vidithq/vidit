"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { detectionItem } from "@/components/detections/detectionItem";
import { Item } from "@/components/ui/Item";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { useCursorList } from "@/hooks/useCursorList";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type DetectionReadiness,
  type PaginatedEventDetails,
} from "@/lib/events";
import type { EventDetail } from "@/types";
import { detectionsQueueHref, profileHref } from "@/lib/routes";
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

// The endpoint is offset-paged, so the walk's cursor is the next page number.
const detectionRows = (list: PaginatedEventDetails) => list.items;
const nextDetectionsPage = ({ items: list }: { items: PaginatedEventDetails }) =>
  list.page * list.per_page < list.total ? String(list.page + 1) : null;

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [filter, setFilter] = useState<DetectionReadiness>("all");

  // The endpoint scopes to `current_user` and ignores the URL username: send a non-owner to their own profile.
  useEffect(() => {
    if (user && !isOwn) router.replace(profileHref(username));
  }, [user, isOwn, username, router]);

  // The filter rides in the path, so a pick refetches server-side instead of hiding rows, and
  // restarts the walk at page 1.
  const buildPath = useCallback(
    (cursor: string | null) =>
      isOwn ? detectionsPath(cursor === null ? 1 : Number(cursor), undefined, filter) : null,
    [isOwn, filter],
  );
  const walk = useCursorList<EventDetail, PaginatedEventDetails>(
    buildPath,
    detectionRows,
    nextDetectionsPage,
  );
  const { items: rows, lastPage: summary } = walk;

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  const reviewHref = `${detectionsQueueHref(username)}/review`;

  let listBody;
  if (walk.error && rows.length === 0) {
    listBody = <ErrorNotice error={walk.error} />;
  } else if (walk.loading || !summary) {
    listBody = <PageLoading variant="line" />;
  } else if (summary.ready_total + summary.incomplete_total === 0) {
    // Reached once the last detection is submitted: nothing links here while the queue is empty.
    listBody = <EmptyState variant="boxed">{NOTHING_HERE.all}</EmptyState>;
  } else {
    listBody = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* The `?` beside the bar explains Ready and Incomplete. */}
          <span className="inline-flex items-center gap-1.5">
            <SegmentedControl
              options={FILTERS}
              value={filter}
              onChange={setFilter}
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
              <Item key={detection.id} variant="list" {...detectionItem(detection)} />
            ))}
          </div>
        )}

        {rows.length < summary.total && (
          // Describes the filtered set the walk pages over.
          <p className="text-center text-xs text-neutral-500">
            {rows.length} of {summary.total} {filter === "all" ? "detections" : filter}
          </p>
        )}
        <LoadMoreRow walk={walk} />
      </div>
    );
  }

  return (
    <PageShell
      back
      title="Detections"
      actions={
        summary && summary.ready_total + summary.incomplete_total > 0 ? (
          <Link href={reviewHref} className={buttonClasses("primary")}>
            <ActionIcon action="review" />
            Start reviewing
          </Link>
        ) : undefined
      }
    >
      {listBody}
    </PageShell>
  );
}
