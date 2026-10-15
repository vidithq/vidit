"use client";

import { useState } from "react";
import Link from "next/link";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { useManagedOrganizations } from "@/hooks/useManagedOrganizations";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  APPROVAL_NOTE_MAX_LEN,
  approvalsPath,
  approveLabel,
  approveEvent,
  canApprove,
  changesSince,
  reviewerApprovalsPath,
  revokeApproval,
  revokedByLabel,
  standingApprovalBefore,
  type Approval,
} from "@/lib/approvals";
import { eventVersionHref, eventVersionPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import type { EventDetail, EventVersion } from "@/types";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

export function ApprovalState({ approval }: { approval: Approval }) {
  if (approval.revoked_at) return <Pill tone="danger">Revoked</Pill>;
  if (approval.current) return <Pill tone="accent">Current</Pill>;
  return <Pill tone="neutral">Outdated</Pill>;
}

/** One review: who placed it (an organization signs with its name, its acting org manager
 *  beside it, or "on behalf of" it once that account is erased) and when, its note, and, once
 *  revoked, the public reason. */
export function ApprovalRow({
  approval,
  onRevoke,
}: {
  approval: Approval;
  onRevoke?: () => void;
}) {
  return (
    <div className="space-y-1 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {approval.organization ? (
            <>
              <AuthorByline
                author={organizationByline(approval.organization)}
                prefix={false}
                avatar
                className="text-sm"
              />
              <span className="text-[11px] text-neutral-500">
                {approval.reviewer ? (
                  <AuthorByline author={approval.reviewer} />
                ) : (
                  `on behalf of ${approval.organization.name}`
                )}
              </span>
            </>
          ) : (
            approval.reviewer && (
              <AuthorByline author={approval.reviewer} prefix={false} avatar className="text-sm" />
            )
          )}
          <ApprovalState approval={approval} />
          <span className="text-[11px] text-neutral-500">{formatDate(approval.created_at)}</span>
        </span>
        {onRevoke && (
          <Button variant="ghost" onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
      {approval.note && (
        <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">{approval.note}</p>
      )}
      {approval.revoked_at && (
        <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">
          {revokedByLabel(approval)} on{" "}
          {formatDate(approval.revoked_at)}: {approval.revoke_reason}
        </p>
      )}
    </div>
  );
}

/**
 * What changed between the version the reader approved and the live event, as the version history
 * names the fields, with a link to the approved version's page. Reads the live event itself when
 * the caller has none (the notification feed).
 */
export function ChangesSinceApproval({
  eventId,
  event,
  approvedVersion,
  approver = "you",
}: {
  eventId: string;
  event?: EventDetail;
  approvedVersion: number;
  /** Who approved `approvedVersion`: the reader, or an organization they manage. */
  approver?: string;
}) {
  const live = useApiResource<EventDetail>(event ? null : `/events/${eventId}`);
  const filed = useApiResource<EventVersion>(eventVersionPath(eventId, approvedVersion));
  const current = event ?? live.data;
  if (!current || !filed.data) return null;
  const changed = changesSince(current, filed.data);
  return (
    <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">
      {changed === null
        ? `Version ${approvedVersion}, which ${approver} approved, was redacted, so its changes cannot be listed.`
        : changed.length === 0
          ? `No versioned field changed since version ${approvedVersion}, which ${approver} approved.`
          : `Changed since version ${approvedVersion}, which ${approver} approved: ${changed.join(", ")}.`}{" "}
      <Link href={eventVersionHref(eventId, approvedVersion)} className={TEXT_LINK}>
        See version {approvedVersion}
      </Link>
    </p>
  );
}

const REVOKE_FIELD_ID = "approval-revoke-reason";
const NOTE_FIELD_ID = "approval-note";

/**
 * The approvals of one version of a published event. On the live version an analyst outside the
 * event's geolocators approves it, as themselves or as an org manager for each organization they
 * manage; the reviewer, an org manager of the organization, or a site admin revokes a review
 * with a public reason. A filed version (`live` false) lists the reviews it held and takes no
 * new one. `onApproved` runs after an approval lands, which resolves review requests.
 */
export function ApprovalsSection({
  event,
  versionNo,
  live,
  onApproved,
}: {
  event: EventDetail;
  versionNo: number;
  live: boolean;
  onApproved?: () => void;
}) {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const managed = useManagedOrganizations();
  const approvals = useApiResource<Approval[]>(approvalsPath(event.id, versionNo));
  const [note, setNote] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // `null` approves as the reader, a slug for that organization; `undefined` revokes.
  const write = useMutation(
    (organization?: string | null) =>
      organization === undefined
        ? revokeApproval(event.id, revoking!, reason.trim())
        : approveEvent(event.id, versionNo, note, organization ?? undefined),
    {
      fallback: "Failed to update the approvals",
      onSuccess: (_result, organization) => {
        setNote("");
        setRevoking(null);
        setReason("");
        approvals.refetch();
        if (organization !== undefined) onApproved?.();
      },
    },
  );

  const rows = approvals.data ?? [];
  const managedSlugs = new Set(managed.map((o) => o.slug));
  const eligible = live && canApprove(event, user?.id, rows);
  const forOrganizations = live
    ? managed.filter((o) => canApprove(event, user?.id, rows, o.slug))
    : [];
  const mine = useApiResource<Approval[]>(
    eligible && user && event.version_no > 1
      ? reviewerApprovalsPath(event.id, user.username)
      : null,
  );
  const approvedVersion = mine.data ? standingApprovalBefore(mine.data, event.version_no) : null;
  if (!eligible && forOrganizations.length === 0 && rows.length === 0 && !approvals.error) {
    return null;
  }

  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      {rows.length > 0 ? (
        <div className="divide-y divide-neutral-800">
          {rows.map((approval) => (
            <div key={approval.id}>
              <ApprovalRow
                approval={approval}
                // Mirrors backend approvals._revoker_role; change both.
                onRevoke={
                  !approval.revoked_at &&
                  revoking !== approval.id &&
                  (isAdmin ||
                    (approval.organization
                      ? managedSlugs.has(approval.organization.slug)
                      : approval.reviewer?.id === user?.id))
                    ? () => {
                        write.reset();
                        setRevoking(approval.id);
                      }
                    : undefined
                }
              />
              {revoking === approval.id && (
                <div className="space-y-2 pb-2">
                  <label htmlFor={REVOKE_FIELD_ID} className={FORM_LABEL}>
                    Reason, shown publicly on the approval
                  </label>
                  <Textarea
                    id={REVOKE_FIELD_ID}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      onClick={() => void write.run(undefined)}
                      disabled={write.loading || !reason.trim()}
                    >
                      Revoke approval
                    </Button>
                    <Button variant="ghost" onClick={() => setRevoking(null)} disabled={write.loading}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        approvals.data && (
          <p className="text-sm text-neutral-500">No approvals of this version yet.</p>
        )
      )}

      {(eligible || forOrganizations.length > 0) && (
        <div className="space-y-2">
          {approvedVersion !== null && (
            <ChangesSinceApproval
              eventId={event.id}
              event={event}
              approvedVersion={approvedVersion}
            />
          )}
          <label htmlFor={NOTE_FIELD_ID} className={FORM_LABEL}>
            Note (optional)
          </label>
          <Textarea
            id={NOTE_FIELD_ID}
            rows={2}
            maxLength={APPROVAL_NOTE_MAX_LEN}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {eligible && (
              <Button onClick={() => void write.run(null)} disabled={write.loading}>
                {approveLabel(versionNo)}
              </Button>
            )}
            {forOrganizations.map((organization) => (
              <Button
                key={organization.slug}
                variant={eligible ? "secondary" : "primary"}
                onClick={() => void write.run(organization.slug)}
                disabled={write.loading}
              >
                Approve as {organization.name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            An approval covers this version only. A new version asks you, or the
            organization&apos;s org managers, to approve again.
          </p>
        </div>
      )}

      {(write.error || approvals.error) && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {write.error ?? approvals.error}
        </div>
      )}
    </Card>
  );
}
