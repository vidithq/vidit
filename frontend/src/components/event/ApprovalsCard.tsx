"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useManagedOrganizations } from "@/hooks/useManagedOrganizations";
import type { ApiResource } from "@/hooks/useApiResource";
import { approveOptions, type Approval, type ApprovalList } from "@/lib/approvals";
import type { OrganizationRef } from "@/lib/organizations";
import type { EventDetail } from "@/types";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import {
  ApprovalHistory,
  ApprovalStamps,
  ApproveForm,
  approvalSigner,
  approvalTally,
} from "@/components/event/Approvals";
import { ReviewRequestsSection } from "@/components/event/ReviewRequestsSection";

const HISTORY_ID = "approval-history";

/** The current approval with a note placed last, or null. */
function latestNote(current: Approval[]): Approval | null {
  return (
    current
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
 * The published event's Approvals card: whether the live version stands approved, its current
 * approvals as stamps, the latest note, the outdated and revoked approvals behind one line,
 * **Approve** for a reader who may approve, and the review requests.
 */
export function ApprovalsCard({
  event,
  approvals,
}: {
  event: EventDetail;
  /** Every version's approvals, fetched once by `useEventActions`. */
  approvals: ApiResource<ApprovalList>;
}) {
  const managed = useManagedOrganizations();
  const [expanded, setExpanded] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);
  const rows = approvals.data?.items ?? [];
  const { closed, current, live, outdatedVersions, revoked } = approvalTally(event, rows);
  const note = latestNote(current);
  const noteSigner = note && approvalSigner(note);
  const outdated = rows.filter((a) => outdatedVersions.includes(a.version_no) && !a.revoked_at);
  const summary = [
    closed && live.length > 0 && `${live.length} stood at closing`,
    outdated.length > 0 &&
      `${outdated.length} outdated (${outdatedVersions.map((v) => `v${v}`).join(", ")})`,
    revoked.length > 0 && `${revoked.length} revoked`,
  ].filter(Boolean);

  return (
    <section aria-label="Approvals">
      <Card>
        <SectionEyebrow title="Approvals" margin="none" />
        {approvals.data && (
          <div className="space-y-3">
            {current.length > 0 ? (
              <Pill tone="accent" icon={<Check size={11} />}>
                Approved · {current.length} · version {event.version_no}
              </Pill>
            ) : (
              <Pill tone="neutral">
                {closed ? "Closed, no current approval" : "Not approved yet"}
              </Pill>
            )}
            <ApprovalStamps approvals={rows} onOverflow={() => setExpanded(true)} />
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
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                aria-controls={expanded ? HISTORY_ID : undefined}
                className="inline-flex items-center gap-1 text-left text-xs text-neutral-500 transition-colors hover:text-neutral-300"
              >
                {summary.length > 0 ? summary.join(" · ") : "All approvals"}
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            {expanded && (
              <div id={HISTORY_ID} className="space-y-3">
                <ApprovalHistory
                  event={event}
                  rows={rows}
                  managed={managed}
                  onRevoked={approvals.refetch}
                />
              </div>
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
        <ReviewRequestsSection event={event} refreshKey={approvedCount} />
      </Card>
    </section>
  );
}
