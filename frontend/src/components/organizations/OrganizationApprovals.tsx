"use client";

import { useCallback } from "react";

import { useCursorList } from "@/hooks/useCursorList";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import {
  organizationApprovalsPath,
  type OrganizationApproval,
} from "@/lib/approvals";
import { ApprovalState } from "@/components/event/Approvals";
import { Card } from "@/components/ui/Card";
import { Item } from "@/components/ui/Item";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The approvals org managers placed in the organization's name, newest first. */
export function OrganizationApprovals({ slug }: { slug: string }) {
  const buildPath = useCallback(
    (cursor: string | null) => organizationApprovalsPath(slug, cursor),
    [slug],
  );
  const walk = useCursorList<OrganizationApproval>(buildPath);
  const { items, error, loading } = walk;

  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      {error && items.length === 0 && <ErrorNotice error={error} />}
      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-neutral-500">No approval in this organization&apos;s name yet.</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map(({ event, approval }) => (
            <li key={approval.id}>
              <Item
                variant="list"
                {...eventItem(event)}
                date={formatDate(approval.created_at)}
                analyst={approval.reviewer ? { author: approval.reviewer } : null}
                extra={[`v${approval.version_no}`]}
                badge={<ApprovalState approval={approval} />}
              />
            </li>
          ))}
        </ul>
      )}
      <LoadMoreRow walk={walk} />
    </Card>
  );
}
