"use client";

import { useCallback } from "react";
import Link from "next/link";

import { useCursorList } from "@/hooks/useCursorList";
import { organizationApprovalsPath, type OrganizationApproval } from "@/lib/approvals";
import { ApprovalRow } from "@/components/event/ApprovalsSection";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

/** The approvals org managers placed in the organization's name, newest first: the geolocation,
 *  then the approval row the event page shows (acting org manager, state, note, revocation). */
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
        <ul className="divide-y divide-neutral-800">
          {items.map(({ event, approval }) => (
            <li key={approval.id} className="pt-2">
              <Link
                href={`/events/${event.id}`}
                className={`${TEXT_LINK} text-sm [overflow-wrap:anywhere]`}
              >
                {event.title}
              </Link>
              <ApprovalRow approval={approval} />
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
