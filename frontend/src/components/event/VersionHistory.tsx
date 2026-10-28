import type { ReactNode } from "react";

import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { countLabel } from "@/lib/format";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

type Walk = Parameters<typeof LoadMoreRow>[0]["walk"] & {
  items: readonly unknown[];
  loading: boolean;
};

/** The body of a record's history page (an event, a site): the count of versions, the rows
 *  newest first, and *Load more*. Only a failed first page shows the error banner; a failed
 *  later page shows in the load-more row. */
export function VersionHistory({
  walk,
  count,
  children,
}: {
  walk: Walk;
  count: number;
  children: ReactNode;
}) {
  const historyError = walk.items.length === 0 ? walk.error : null;
  return (
    <>
      {historyError && <ErrorNotice error={historyError} />}
      {walk.loading ? (
        <p className="text-sm text-neutral-500">Loading versions…</p>
      ) : (
        <>
          <p className="text-[11px] text-neutral-500">
            <span className="text-neutral-300 font-medium">{countLabel(count, "version")}</span> ·
            newest first
          </p>
          <div className="space-y-2">{children}</div>
          <LoadMoreRow walk={walk} />
        </>
      )}
    </>
  );
}
