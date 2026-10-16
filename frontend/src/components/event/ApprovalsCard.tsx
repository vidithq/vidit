"use client";

import { useState } from "react";
import { Check } from "lucide-react";

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
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovalStamps,
  ApproveForm,
  RevokeForm,
  YourOutdatedApproval,
  approvalSigner,
} from "@/components/event/Approvals";
import { ApprovalRequestsSection } from "@/components/event/ApprovalRequestsSection";

// Stamps shown before the +N bubble, which shows the rest.
const STAMPS_SHOWN = 5;

/** The standing approval with a note placed last, or null. */
function latestNote(standing: Approval[]): Approval | null {
  return (
    standing
      .filter((a) => a.note)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/** **Approve** for a reader who may approve the live version, expanding the approve form in
 *  place; **Cancel** collapses it again. */
function ApproveAction({
  event,
  approvals,
  managed,
  onApproved,
}: {
  event: EventDetail;
  approvals: ApprovalList;
  managed: OrganizationRef[];
  onApproved: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { eligible, organizations } = approveOptions(event, approvals, managed, user?.id);
  if (!eligible && organizations.length === 0) return null;
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Approve
        </Button>
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
 * The published event's Approvals card, about the live version only: whether it stands approved,
 * its standing approvals as stamps (whose cards offer **Revoke** to whoever may revoke), the
 * latest note, the reader's own outdated approval with what changed since, **Approve** for a
 * reader who may approve, and the approval requests. Outdated and revoked approvals are read on
 * each version's page.
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
  const rows = approvals.data?.items ?? [];
  const closed = event.status !== "geolocated";
  // The live version's standing approvals: current, or, on a closed event, those that stood when
  // it closed.
  const standing = rows.filter((a) => a.version_no === event.version_no && !a.revoked_at);
  const note = latestNote(standing);
  const noteSigner = note && approvalSigner(note);
  const outdatedOwn = standingApprovalBefore(
    rows.filter((a) => !a.organization && a.reviewer?.id === user?.id),
    event.version_no,
  );

  return (
    <section aria-label="Approvals">
      <Card>
        <SectionEyebrow title="Approvals" margin="none" />
        {approvals.data && (
          <div className="space-y-3">
            {standing.length > 0 && !closed ? (
              <Pill tone="accent" icon={<Check size={11} />}>
                Approved · {standing.length} · version {event.version_no}
              </Pill>
            ) : (
              <Pill tone="neutral">
                {!closed
                  ? "Not approved yet"
                  : standing.length > 0
                    ? `Closed · ${standing.length} stood at closing`
                    : "Closed, no current approval"}
              </Pill>
            )}
            <ApprovalStamps
              approvals={standing}
              max={showAll ? standing.length : STAMPS_SHOWN}
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
            {note && (
              <figure className="space-y-1">
                <blockquote className="line-clamp-4 border-l-2 border-neutral-700 pl-3 text-sm text-neutral-300 [overflow-wrap:anywhere]">
                  {note.note}
                </blockquote>
                {noteSigner && (
                  <figcaption className="pl-3 text-xs text-neutral-500">
                    <AuthorByline author={noteSigner} />
                  </figcaption>
                )}
              </figure>
            )}
            {outdatedOwn !== null && (
              <YourOutdatedApproval event={event} approvedVersion={outdatedOwn} />
            )}
            <ApproveAction
              event={event}
              approvals={approvals.data}
              managed={managed}
              onApproved={() => {
                approvals.refetch();
                setApprovedCount((n) => n + 1);
              }}
            />
          </div>
        )}
        {approvals.error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {approvals.error}
          </div>
        )}
        <ApprovalRequestsSection event={event} refreshKey={approvedCount} />
      </Card>
    </section>
  );
}
