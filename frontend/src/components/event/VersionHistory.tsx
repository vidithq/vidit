import type { ReactNode } from "react";

import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

type Walk = Parameters<typeof LoadMoreRow>[0]["walk"] & {
  items: readonly unknown[];
  loading: boolean;
};

/** The body of a record's history page (an event, a site): the rows newest first, and *Load
 *  more*. Only a failed first page shows the error banner; a failed later page shows in the
 *  load-more row. */
export function VersionHistory({ walk, children }: { walk: Walk; children: ReactNode }) {
  const historyError = walk.items.length === 0 ? walk.error : null;
  return (
    <>
      {historyError && <ErrorNotice error={historyError} />}
      {walk.loading ? (
        <p className="text-sm text-neutral-500">Loading versions…</p>
      ) : (
        <>
          {/* One name column for every row, as wide as the widest name: each row is a subgrid of it. */}
          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-3">{children}</div>
          <LoadMoreRow walk={walk} />
        </>
      )}
    </>
  );
}
