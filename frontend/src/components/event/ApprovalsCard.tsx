"use client";

import { useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useMemberOrganizations } from "@/hooks/useMemberOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import {
  blockingRevocation,
  cannotApproveAgainLine,
  organizationApprovalOnLive,
  ownApprovalOnLive,
  standingApprovalBefore,
  type ApprovalList,
} from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovalStamps,
  ApproveButtons,
  RevokeApproval,
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
 * The published event's Approvals card, about the live version only: its standing approvals as
 * stamps that link to each signer's page, or *No approvals yet*; the reader's own outdated
 * approval with what changed since; **Approve** (and **Approve as <organization>**) for a reader
 * who may approve, with who asked the reader for approval and **Decline** beside it; **Revoke** in
 * its place once the reader's own approval of the live version stands, and **Revoke as
 * <organization>** once one of the reader's organizations' approval stands, or why the reader cannot
 * approve this version again once a site admin revoked it; and a geolocator's approval requests. Outdated and revoked approvals are read on each
 * version's page.
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
  const incoming = useApprovalRequests(event, approvedCount);
  const rows = approvals.data?.items ?? [];
  // The live version's standing approvals: current, or, on a closed event, those that stood when
  // it closed.
  const standing = rows.filter((a) => a.version_no === event.version_no && !a.revoked_at);
  const outdatedOwn = standingApprovalBefore(
    rows.filter((a) => !a.organization && a.reviewer?.id === user?.id),
    event.version_no,
  );
  const own = ownApprovalOnLive(rows, event.version_no, user?.id);
  const blocked = own ? null : blockingRevocation(rows, event.version_no, user?.id);
  const organizationApprovals = memberOf.flatMap(
    (o) => organizationApprovalOnLive(rows, event.version_no, o.slug) ?? [],
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
            {blocked && approvals.data.viewer_can_approve && (
              <p className="text-xs text-neutral-500">{cannotApproveAgainLine(blocked)}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 empty:hidden">
              {[...(own ? [own] : []), ...organizationApprovals].map((approval) => (
                <RevokeApproval
                  key={approval.id}
                  eventId={event.id}
                  approval={approval}
                  onRevoked={approvals.refetch}
                />
              ))}
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
