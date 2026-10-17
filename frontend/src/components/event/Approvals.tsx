"use client";

import { useState } from "react";
import Link from "next/link";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { ApiError } from "@/lib/api";
import {
  approvalsPath,
  approveEvent,
  approveOptions,
  changesSince,
  revokeApproval,
  revokedByLabel,
  type Approval,
  type ApprovalList,
} from "@/lib/approvals";
import { eventVersionHref, eventVersionPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import type { EventDetail, EventVersion } from "@/types";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/AvatarStack";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Tooltip } from "@/components/ui/Tooltip";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

export function ApprovalState({ approval }: { approval: Approval }) {
  if (approval.revoked_at) return <Pill tone="danger">Revoked</Pill>;
  if (approval.current) return <Pill tone="accent">Current</Pill>;
  return <Pill tone="neutral">Outdated</Pill>;
}

/** One review: who placed it (an organization signs with its name, its acting org manager
 *  beside it, or "on behalf of" it once that account is erased) and when, and, once revoked,
 *  when and by which role, with the public reason when one was given. */
export function ApprovalRow({ approval }: { approval: Approval }) {
  return (
    <div className="space-y-1 py-2">
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
      {approval.revoked_at && (
        <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">
          {revokedByLabel(approval)} on {formatDate(approval.revoked_at)}
          {approval.revoke_reason ? `: ${approval.revoke_reason}` : "."}
        </p>
      )}
    </div>
  );
}

/**
 * The reader's own approval of an earlier version, now outdated: *You approved v2. Changed since:
 * Title, Proof.*, the fields named as the version history names them, with the version linking to
 * its page.
 */
export function YourOutdatedApproval({
  event,
  approvedVersion,
}: {
  event: EventDetail;
  approvedVersion: number;
}) {
  const filed = useApiResource<EventVersion>(eventVersionPath(event.id, approvedVersion));
  if (!filed.data) return null;
  const changed = changesSince(event, filed.data);
  return (
    <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">
      You approved{" "}
      <Link href={eventVersionHref(event.id, approvedVersion)} className={TEXT_LINK}>
        v{approvedVersion}
      </Link>
      .{" "}
      {changed === null
        ? "That version was redacted, so its changes cannot be listed."
        : changed.length === 0
          ? "No versioned field changed since."
          : `Changed since: ${changed.join(", ")}.`}
    </p>
  );
}

/** The stamp of an approval: the organization it speaks for, or the reviewer; null for an
 *  analyst's approval whose account was erased. */
function approvalStamp(approval: Approval): AvatarStackItem | null {
  if (approval.organization) {
    const org = organizationByline(approval.organization);
    return {
      key: approval.id,
      name: org.username,
      avatarUrl: org.avatar_url,
      variant: "organization",
      label: org.username,
      href: org.href,
    };
  }
  if (!approval.reviewer) return null;
  return {
    key: approval.id,
    name: approval.reviewer.username,
    avatarUrl: approval.reviewer.avatar_url,
    variant: "analyst",
    label: approval.reviewer.username,
    href: `/profile/${approval.reviewer.username}`,
  };
}

/** The given approvals, oldest first, as stamps that link to each signer's page. Renders
 *  nothing for an empty list. */
export function ApprovalStamps({
  approvals,
  max,
  onOverflow,
}: {
  approvals: Approval[];
  max?: number;
  onOverflow?: () => void;
}) {
  return (
    <AvatarStack
      items={approvals.flatMap((a) => approvalStamp(a) ?? [])}
      label="Approved by"
      max={max}
      spacing="gap"
      onOverflow={onOverflow}
      overflowLabel={(hidden) => `Show ${hidden} more approvals`}
    />
  );
}

/**
 * The approve controls of the live version, each approving in one click: **Approve** for an
 * analyst outside the event's geolocators who has not reviewed it, and one **Approve as
 * <organization>** per organization the reader manages whose approval of it does not stand. A
 * stale version offers **Reload**.
 */
export function ApproveButtons({
  event,
  approvals,
  managed,
  onApproved,
}: {
  event: EventDetail;
  approvals: ApprovalList;
  managed: OrganizationRef[];
  onApproved: (approval: Approval) => void;
}) {
  const { user } = useAuth();
  const [stale, setStale] = useState(false);
  // The list an approval landed on: the buttons hold until the refetch replaces it, or a quick
  // second click would answer 409.
  const [approvedOn, setApprovedOn] = useState<ApprovalList | null>(null);
  const busy = approvedOn === approvals;
  const approve = useMutation(
    (organization: string | null) =>
      approveEvent(event.id, event.version_no, organization ?? undefined),
    {
      fallback: "Failed to approve",
      onError: (err) => {
        setStale(err instanceof ApiError && err.code === "version_mismatch");
        return undefined;
      },
      onSuccess: (approval) => {
        setApprovedOn(approvals);
        onApproved(approval);
      },
    },
  );

  const { eligible, organizations } = approveOptions(event, approvals, managed, user?.id);
  if (!eligible && organizations.length === 0 && !approve.error) return null;

  return (
    <>
      {eligible && (
        <Button
          variant="secondary"
          onClick={() => void approve.run(null)}
          disabled={approve.loading || busy}
        >
          Approve
        </Button>
      )}
      {organizations.map((organization) => (
        <Button
          key={organization.slug}
          variant="secondary"
          onClick={() => void approve.run(organization.slug)}
          disabled={approve.loading || busy}
        >
          Approve as {organization.name}
        </Button>
      ))}
      {approve.error && (
        <div className={`${FORM_ERROR_BANNER} w-full`} role="alert">
          {approve.error}
        </div>
      )}
      {approve.error && stale && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      )}
    </>
  );
}

/** **Revoke** for the reader's own standing approval of the live version, armed by a first click
 *  and sent by the second; no reason is asked. */
export function RevokeOwnApproval({
  eventId,
  approval,
  onRevoked,
}: {
  eventId: string;
  approval: Approval;
  onRevoked: () => void;
}) {
  const revoke = useMutation(() => revokeApproval(eventId, approval.id), {
    fallback: "Failed to revoke the approval",
    onSuccess: onRevoked,
  });
  const { armed, trigger, controlRef } = useConfirmAction(
    () => revoke.run().then(() => undefined),
    { timeoutMs: ARM_MS, dismissOnOutside: true },
  );
  return (
    <>
      <Tooltip label="Withdraw your approval of this version">
        <Button
          ref={controlRef}
          variant="secondary"
          className={armed ? DANGER_CONFIRM : ""}
          onClick={trigger}
          disabled={revoke.loading}
        >
          {armed ? "Confirm revoke" : "Revoke"}
        </Button>
      </Tooltip>
      {revoke.error && (
        <div className={`${FORM_ERROR_BANNER} w-full`} role="alert">
          {revoke.error}
        </div>
      )}
    </>
  );
}

/** The reviews a filed version (`/events/{id}/vN`) held, outdated and revoked alike, each revoked
 *  one with its public reason when one was given, read-only. Absent when the version held none. */
export function VersionApprovals({ event, versionNo }: { event: EventDetail; versionNo: number }) {
  const approvals = useApiResource<ApprovalList>(approvalsPath(event.id, versionNo));
  const rows = approvals.data?.items ?? [];
  if (rows.length === 0 && !approvals.error) return null;
  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      <div className="divide-y divide-neutral-800">
        {rows.map((approval) => (
          <ApprovalRow key={approval.id} approval={approval} />
        ))}
      </div>
      {approvals.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {approvals.error}
        </div>
      )}
    </Card>
  );
}
