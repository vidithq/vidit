"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useMemberOrganizations } from "@/hooks/useMemberOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import { approvalBefore, approveOptions, type ApprovalList } from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovedBy,
  ApproveButtons,
  YourOutdatedApproval,
} from "@/components/event/Approvals";
import {
  ApprovalRequestsSection,
  DeclineRequests,
  IncomingRequests,
  useApprovalRequests,
} from "@/components/event/ApprovalRequestsSection";

/**
 * A published event's approvals, about the live version only, as two nodes that share one read of
 * the approval requests:
 *
 * - `summary`, under the actions row: the stamps that link to each signer's page; the reader's
 *   own outdated approval with what changed since; who asked the reader for approval; **Approve**
 *   (and **Approve as <organization>**) for a reader who may approve, with **Decline** beside it.
 *   Null when none of these applies, so an event without approvals shows nothing to a reader who
 *   cannot approve it.
 * - `requests`, a geolocator's approval requests, for the side column under the Location module.
 *
 * Outdated approvals are read on each version's page. `event` is null while the row loads and on
 * a surface without approvals: both nodes are null then.
 */
export function useEventApprovals(
  event: EventDetail | null,
  /** Every version's approvals, fetched once by `useEventActions`. */
  approvals: ApiResource<ApprovalList>,
): { summary: ReactNode; requests: ReactNode } {
  const { user } = useAuth();
  const memberOf = useMemberOrganizations();
  const [approvedCount, setApprovedCount] = useState(0);
  const incoming = useApprovalRequests(event, memberOf, approvedCount);
  if (!event) return { summary: null, requests: null };

  const rows = approvals.data?.items ?? [];
  // The live version's approvals: current, or, on a closed event, those it held when it closed.
  const standing = rows.filter((a) => a.version_no === event.version_no);
  const outdatedOwn = approvalBefore(
    rows.filter((a) => !a.organization && a.reviewer?.id === user?.id),
    event.version_no,
  );
  const options = approvals.data && approveOptions(event, approvals.data, memberOf, user?.id);
  const mayApprove = !!options && (options.eligible || options.organizations.length > 0);
  const shows =
    standing.length > 0 ||
    outdatedOwn !== null ||
    incoming.mine.length > 0 ||
    mayApprove ||
    approvals.error !== null;

  const summary = shows && (
    <section aria-label="Approvals" className="space-y-3 lg:text-right">
      {approvals.data && (
        <>
          <ApprovedBy approvals={standing} onDeleted={approvals.refetch} />
          {outdatedOwn !== null && (
            <YourOutdatedApproval event={event} approvedVersion={outdatedOwn} />
          )}
          {incoming.mine.length > 0 && <IncomingRequests requests={incoming.mine} />}
          <div className="flex flex-wrap items-center gap-2 empty:hidden lg:justify-end">
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
            {/* With no stamp to sit beside, the help sits beside Approve. */}
            {standing.length === 0 && mayApprove && <FieldHelp concept="approval" />}
          </div>
        </>
      )}
      {approvals.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {approvals.error}
        </div>
      )}
    </section>
  );
  return { summary, requests: <ApprovalRequestsSection event={event} requests={incoming} /> };
}
