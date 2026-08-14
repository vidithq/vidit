"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsPath,
  type DetectionReadiness,
  type PaginatedEventDetails,
} from "@/lib/events";

/** The queue's one filter: everything, the drafts that only need the two human
 *  choices, or the ones still missing evidence. It is a query the server
 *  answers over the whole queue, so what the page reports is the queue and not
 *  the ten rows that happen to be loaded. */
const FILTERS: { value: DetectionReadiness; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "incomplete", label: "Incomplete" },
];

/** The empty line per filter, naming the set that came back empty. */
const NOTHING_HERE: Record<DetectionReadiness, string> = {
  all: "No detections to submit.",
  ready: "No ready drafts.",
  incomplete: "No incomplete drafts.",
};

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<DetectionReadiness>("all");

  // The list is the caller's own: the endpoint scopes to ``current_user`` and
  // ignores the URL username, so viewing it under another analyst's handle
  // would show your detections under their name. Send a non-owner to that
  // profile.
  useEffect(() => {
    if (user && !isOwn) router.replace(`/profile/${username}`);
  }, [user, isOwn, username, router]);

  // The filter rides in the path, so picking one refetches instead of hiding
  // rows: the page it lands on is cut from the filtered queue server-side.
  const { data, error } = useApiResource<PaginatedEventDetails>(
    isOwn ? detectionsPath(page, undefined, filter) : null
  );

  // A filter change restarts the walk: page 4 of the whole queue is not page 4
  // of the ready one, and landing past the end would show an empty page over a
  // non-empty set.
  const pick = (next: DetectionReadiness) => {
    setFilter(next);
    setPage(1);
  };

  if (authLoading || !user || !isOwn) {
    return <PageLoading />;
  }

  const reviewHref = `/profile/${username}/detections/review`;

  let listBody;
  if (error) {
    listBody = <p className="text-sm text-neutral-300">{error}</p>;
  } else if (!data) {
    listBody = <p className="text-sm text-neutral-500">Loading…</p>;
  } else if (data.ready_total + data.incomplete_total === 0) {
    // Nothing in the queue at all, whatever the filter says: the import pitch,
    // not a filter that came back empty.
    listBody = (
      <EmptyState
        variant="plain"
        lead={NOTHING_HERE.all}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* The three labels are one word each, so the `?` beside the bar
              carries what Ready and Incomplete stand for, the same affordance
              every other explanation on the app hangs from. */}
          <span className="inline-flex items-center gap-1.5">
            <SegmentedControl
              options={FILTERS}
              value={filter}
              onChange={pick}
              aria-label="Filter the queue"
            />
            <FieldHelp concept="detection_queue_filter" />
          </span>
          {/* The whole queue split in two, under every filter and on every
              page, so the split is read at a glance rather than counted by
              paging. */}
          <span className="text-xs text-neutral-500">
            {data.ready_total} ready · {data.incomplete_total} incomplete
          </span>
        </div>

        {data.items.length === 0 ? (
          <EmptyState variant="boxed">{NOTHING_HERE[filter]}</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.items.map((draft) => (
              <DetectionQueueRow key={draft.id} draft={draft} />
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
            {/* Both figures describe the filtered set: the pager walks it, so
                it is what the count has to name. */}
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
      subtitle="Machine drafts awaiting a pass. Open a row to work on it, or review them one after another on the same form."
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
