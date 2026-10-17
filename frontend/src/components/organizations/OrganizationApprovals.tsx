"use client";

import { useCallback } from "react";
import { BadgeCheck } from "lucide-react";

import { useCursorList } from "@/hooks/useCursorList";
import { formatDate } from "@/lib/format";
import {
  organizationApprovalsPath,
  revokedByLabel,
  type OrganizationApproval,
} from "@/lib/approvals";
import { ApprovalState } from "@/components/event/Approvals";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LinkRow } from "@/components/ui/LinkRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/** One approval as a row to its event: the acting org manager's picture, the event title, then the
 *  version, who placed it and when, its state and, once revoked, by which role and why. */
function ApprovalLinkRow({ event, approval }: OrganizationApproval) {
  const reviewer = approval.reviewer;
  return (
    <LinkRow
      variant="arrow"
      icon={BadgeCheck}
      leading={
        reviewer && (
          <Avatar src={reviewer.avatar_url} username={reviewer.username} size="size-7" decorative />
        )
      }
      value={event.title}
      meta={
        <>
          <span>
            v{approval.version_no}
            {reviewer ? ` · by ${reviewer.username}` : ""} on {formatDate(approval.created_at)}
          </span>
          <ApprovalState approval={approval} />
          {approval.revoked_at && (
            <span className="basis-full [overflow-wrap:anywhere]">
              {revokedByLabel(approval)} on {formatDate(approval.revoked_at)}
              {approval.revoke_reason ? `: ${approval.revoke_reason}` : "."}
            </span>
          )}
        </>
      }
      href={`/events/${event.id}`}
      external={false}
    />
  );
}

/** The approvals org managers placed in the organization's name, newest first. */
export function OrganizationApprovals({ slug }: { slug: string }) {
  const buildPath = useCallback(
    (cursor: string | null) => organizationApprovalsPath(slug, cursor),
    [slug],
  );
  const { items, error, loading, loadingMore, hasMore, loadMore } =
    useCursorList<OrganizationApproval>(buildPath);

  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-neutral-500">No approval in this organization&apos;s name yet.</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.approval.id}>
              <ApprovalLinkRow {...item} />
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </Card>
  );
}
