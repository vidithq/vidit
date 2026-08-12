"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TEXT_LINK } from "@/components/ui/styles";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  batchCompletionBlockers,
  detectionsPath,
  type PaginatedEventDetails,
} from "@/lib/events";

/** The queue's one filter: everything, the drafts that only need the two human
 *  choices, or the ones still missing evidence. Client-side, over the page on
 *  screen: readiness is computed from the payload, not asked of the server. */
type QueueFilter = "all" | "ready" | "incomplete";

/** One-word labels for three states an analyst has no way to tell apart from
 *  the words alone, so each option carries the sentence it stands for. The
 *  wording matches the row badges: "Ready" is about evidence, never about the
 *  draft being finished. */
const FILTERS: { value: QueueFilter; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Every draft on this page, ready or not." },
  {
    value: "ready",
    label: "Ready",
    title:
      "Drafts the import left with every piece of evidence they need. A review pass adds the conflict and the capture source, then publishes them.",
  },
  {
    value: "incomplete",
    label: "Incomplete",
    title:
      "Drafts the import left short of the evidence floor. A review can't supply what's missing, so open one on the full form to fill it in.",
  },
];

export default function DetectionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const username = typeof params.username === "string" ? params.username : "";
  const isOwn = !!user && user.username === username;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<QueueFilter>("all");

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

  const reviewHref = `/profile/${username}/detections/review`;

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
    const rows = data.items.filter((draft) => {
      if (filter === "all") return true;
      const ready = batchCompletionBlockers(draft).length === 0;
      return filter === "ready" ? ready : !ready;
    });
    listBody = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            aria-label="Filter the queue"
          />
          <span className="text-xs text-neutral-500">
            {rows.length} of {data.items.length} on this page
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState variant="boxed">
            No {filter} drafts on this page.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {rows.map((draft) => (
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
      subtitle="Machine drafts awaiting a pass. Review them one at a time, or open a row to fix it on the full form."
      actions={
        data && data.items.length > 0 ? (
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
