"use client";

import { useCallback } from "react";
import { BadgeCheck } from "lucide-react";

import { useCursorList } from "@/hooks/useCursorList";
import { formatDate } from "@/lib/format";
import {
  organizationApprovalsPath,
  type OrganizationApproval,
} from "@/lib/approvals";
import { ApprovalState } from "@/components/event/Approvals";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { LinkRow } from "@/components/ui/LinkRow";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { eventHref } from "@/lib/routes";

/** One approval as a row to its event: the acting org manager's picture, the event title, then the
 *  version, who placed it and when, and its state. */
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
        </>
      }
      href={eventHref(event.id)}
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
  const walk = useCursorList<OrganizationApproval>(buildPath);
  const { items, error, loading } = walk;

  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      {error && items.length === 0 && <div className={FORM_ERROR_BANNER}>{error}</div>}
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
      <LoadMoreRow walk={walk} />
    </Card>
  );
}
