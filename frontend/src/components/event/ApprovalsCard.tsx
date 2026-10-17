"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useManagedOrganizations } from "@/hooks/useManagedOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import {
  approveOptions,
  standingApprovalBefore,
  type Approval,
  type ApprovalList,
} from "@/lib/approvals";
import type { OrganizationRef } from "@/lib/organizations";
import type { EventDetail } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovalStamps,
  ApproveForm,
  RevokeForm,
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

/** **Approve** for a reader who may approve the live version, expanding the approve form in
 *  place; **Cancel** collapses it again. `beside` sits next to **Approve** while it is closed. */
function ApproveAction({
  event,
  approvals,
  managed,
  onApproved,
  beside,
}: {
  event: EventDetail;
  approvals: ApprovalList;
  managed: OrganizationRef[];
  onApproved: () => void;
  beside?: ReactNode;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { eligible, organizations } = approveOptions(event, approvals, managed, user?.id);
  const mayApprove = eligible || organizations.length > 0;
  if (!open || !mayApprove) {
    if (!mayApprove && !beside) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {mayApprove && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Approve
          </Button>
        )}
        {beside}
      </div>
    );
  }
  return (
    <ApproveForm
      event={event}
      approvals={approvals}
      managed={managed}
      onApproved={onApproved}
      onCancel={() => setOpen(false)}
    />
  );
}

/**
 * The published event's Approvals card, about the live version only: its standing approvals as
 * stamps, whose cards hold each note and offer **Revoke** to whoever may revoke, or *No approvals
 * yet*; the reader's own outdated approval with what changed since; **Approve** for a reader who
 * may approve, with who asked the reader for approval and **Decline** beside it; and a
 * geolocator's approval requests. Outdated and revoked approvals are read on each
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
  const managed = useManagedOrganizations();
  const [showAll, setShowAll] = useState(false);
  const [revoking, setRevoking] = useState<Approval | null>(null);
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
              managed={managed}
              onRevoke={setRevoking}
            />
            {revoking && (
              <RevokeForm
                key={revoking.id}
                eventId={event.id}
                approval={revoking}
                onRevoked={() => {
                  setRevoking(null);
                  approvals.refetch();
                }}
                onCancel={() => setRevoking(null)}
              />
            )}
            {outdatedOwn !== null && (
              <YourOutdatedApproval event={event} approvedVersion={outdatedOwn} />
            )}
            {incoming.mine.length > 0 && <IncomingRequests requests={incoming.mine} />}
            <ApproveAction
              event={event}
              approvals={approvals.data}
              managed={managed}
              onApproved={() => {
                approvals.refetch();
                setApprovedCount((n) => n + 1);
              }}
              beside={
                incoming.mine.length > 0 && (
                  <DeclineRequests
                    eventId={event.id}
                    requests={incoming.mine}
                    onAnswered={incoming.requests.refetch}
                  />
                )
              }
            />
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
