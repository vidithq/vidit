"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useMemberOrganizations } from "@/hooks/useMemberOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import { canRequestApproval } from "@/lib/approvalRequests";
import { approvalBefore, approveOptions, type ApprovalList } from "@/lib/approvals";
import type { EventDetail } from "@/types";
import { FieldHelp } from "@/components/ui/FieldHelp";
import {
  ApprovedBy,
  ApproveButtons,
  YourOutdatedApproval,
} from "@/components/event/Approvals";
import {
  DeclineRequests,
  IncomingRequests,
  RequestApprovalAction,
  useApprovalRequests,
} from "@/components/event/ApprovalRequests";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/**
 * A published event's approvals, about the live version only, as three nodes that share one read
 * of the approval requests:
 *
 * - `summary`, under the actions row: the stamps that link to each signer's page; the reader's
 *   own outdated approval with what changed since; who asked the reader for approval. Null when
 *   none of these applies, so an event without approvals shows nothing there.
 * - `answer`, for the actions row: **Approve** (a menu of identities when the reader may approve
 *   as several) for a reader who may approve, and **Decline** for a reader someone asked. Null
 *   for every other reader.
 * - `requestAction`, **Request approval** for a reader who may send a request (a geolocator), for
 *   the actions row: it opens the dialog holding the open requests and the picker that sends one.
 *   Null for every other reader.
 *
 * Outdated approvals are read on each version's page. `event` is null while the row loads and on
 * a surface without approvals: both nodes are null then.
 */
export function useEventApprovals(
  event: EventDetail | null,
  /** Every version's approvals, fetched once by `useEventActions`. */
  approvals: ApiResource<ApprovalList>,
): { summary: ReactNode; answer: ReactNode; requestAction: ReactNode } {
  const { user } = useAuth();
  const memberOf = useMemberOrganizations();
  const [approvedCount, setApprovedCount] = useState(0);
  const incoming = useApprovalRequests(event, memberOf, approvedCount);
  if (!event) return { summary: null, answer: null, requestAction: null };

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
        </>
      )}
      {approvals.error && (
        <ErrorNotice error={approvals.error} />
      )}
    </section>
  );
  const answer = approvals.data && (mayApprove || incoming.mine.length > 0) && (
    <>
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
      {standing.length === 0 && mayApprove && (
        // `max-sm:pr-2`: the `?` grows its tap area 8px past its glyph on a phone, which stays
        // inside the row's right edge.
        <span className="inline-flex max-sm:pr-2">
          <FieldHelp concept="approval" />
        </span>
      )}
    </>
  );
  const requestAction = canRequestApproval(event, user?.id) && (
    <RequestApprovalAction event={event} requests={incoming} />
  );
  return { summary, answer, requestAction };
}
