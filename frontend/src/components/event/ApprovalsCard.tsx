"use client";

import { useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useMemberOrganizations } from "@/hooks/useMemberOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import { approvalBefore, type ApprovalList } from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovalStamps,
  ApproveButtons,
  YourOutdatedApproval,
} from "@/components/event/Approvals";
import {
  ApprovalRequestsSection,
  DeclineRequests,
  IncomingRequests,
  useApprovalRequests,
} from "@/components/event/ApprovalRequestsSection";

// Two full rows in the 17.5rem rail card: 238px inside its padding holds seven 28px stamps 6px apart.
const STAMP_SLOTS = 14;

/**
 * The published event's Approvals card, about the live version only: its approvals as stamps that
 * link to each signer's page, or *No approvals yet*; the reader's own outdated approval with what
 * changed since; **Approve** (and **Approve as <organization>**) for a reader who may approve, with
 * who asked the reader for approval and **Decline** beside it; and a geolocator's approval
 * requests. Outdated approvals are read on each version's page.
 */
export function ApprovalsCard({
  event,
  approvals,
}: {
  event: EventDetail;
  /** Every version's approvals, fetched once by `useEventActions`. */
  approvals: ApiResource<ApprovalList>;
}) {
  const { user } = useAuth();
  const memberOf = useMemberOrganizations();
  const [showAll, setShowAll] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);
  const incoming = useApprovalRequests(event, memberOf, approvedCount);
  const rows = approvals.data?.items ?? [];
  // The live version's approvals: current, or, on a closed event, those it held when it closed.
  const standing = rows.filter((a) => a.version_no === event.version_no);
  const outdatedOwn = approvalBefore(
    rows.filter((a) => !a.organization && a.reviewer?.id === user?.id),
    event.version_no,
  );

  return (
    <section aria-label="Approvals">
      <Card>
        <SectionEyebrow title="Approvals" concept="approval_version" margin="none" />
        {approvals.data && (
          <div className="space-y-3">
            {standing.length === 0 && (
              <p className="text-sm text-neutral-500">No approvals yet</p>
            )}
            <ApprovalStamps
              approvals={standing}
              max={
                showAll || standing.length <= STAMP_SLOTS ? standing.length : STAMP_SLOTS - 1
              }
              onOverflow={() => setShowAll(true)}
            />
            {outdatedOwn !== null && (
              <YourOutdatedApproval event={event} approvedVersion={outdatedOwn} />
            )}
            {incoming.mine.length > 0 && <IncomingRequests requests={incoming.mine} />}
            <div className="flex flex-wrap items-center gap-2 empty:hidden">
              <ApproveButtons
                event={event}
                approvals={approvals.data}
                memberOf={memberOf}
                onApproved={() => {
                  approvals.refetch();
                  setApprovedCount((n) => n + 1);
                }}
              />
              {incoming.mine.length > 0 && (
                <DeclineRequests
                  eventId={event.id}
                  requests={incoming.mine}
                  onAnswered={incoming.requests.refetch}
                />
              )}
            </div>
          </div>
        )}
        {approvals.error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {approvals.error}
          </div>
        )}
        <ApprovalRequestsSection event={event} requests={incoming} />
      </Card>
    </section>
  );
}
