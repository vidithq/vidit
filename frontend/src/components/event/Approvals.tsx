"use client";

import { useState } from "react";
import Link from "next/link";
import { Stamp } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { ApiError } from "@/lib/api";
import {
  approvalsPath,
  approveEvent,
  approveOptions,
  changesSince,
  type Approval,
  type ApprovalList,
} from "@/lib/approvals";
import { eventVersionHref, eventVersionPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import type { EventDetail, EventVersion } from "@/types";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { profileHref } from "@/lib/routes";

export function ApprovalState({ approval }: { approval: Approval }) {
  if (approval.current) return <Pill tone="accent">Current</Pill>;
  return <Pill tone="neutral">Outdated</Pill>;
}

/** One approval: who placed it (an organization signs with its name, its acting member
 *  beside it, or "on behalf of" it once that account is erased) and when. */
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
    href: profileHref(approval.reviewer.username),
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
 * The approve controls of the live version: **Approve** for an analyst outside the event's
 * geolocators who has not approved it, and one **Approve as <organization>** per organization the
 * reader is a member of that has not approved it. An approval is final, so a click opens a
 * confirmation step naming the version (and the organization) before anything is sent. A stale
 * version offers **Reload**.
 */
export function ApproveButtons({
  event,
  approvals,
  memberOf,
  onApproved,
}: {
  event: EventDetail;
  approvals: ApprovalList;
  memberOf: OrganizationRef[];
  onApproved: () => void;
}) {
  const { user } = useAuth();
  const [stale, setStale] = useState(false);
  // `undefined` while closed; `null` confirms the reader's own approval, a ref an organization's.
  const [confirming, setConfirming] = useState<OrganizationRef | null | undefined>(undefined);
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
        setConfirming(undefined);
        return undefined;
      },
      onSuccess: () => {
        setApprovedOn(approvals);
        setConfirming(undefined);
        onApproved();
      },
    },
  );

  const { eligible, organizations } = approveOptions(event, approvals, memberOf, user?.id);
  if (!eligible && organizations.length === 0 && !approve.error) return null;

  const open = (organization: OrganizationRef | null) => {
    approve.reset();
    setConfirming(organization);
  };

  return (
    <>
      {eligible && (
        <Button variant="secondary" onClick={() => open(null)} disabled={approve.loading || busy}>
          <Stamp size={14} />
          Approve
        </Button>
      )}
      {organizations.map((organization) => (
        <Button
          key={organization.slug}
          variant="secondary"
          onClick={() => open(organization)}
          disabled={approve.loading || busy}
        >
          <Stamp size={14} />
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
      {confirming !== undefined && (
        <ConfirmDialog
          title={confirming ? `Approve as ${confirming.name}?` : "Approve this version?"}
          confirmLabel="Approve"
          busyLabel="Approving…"
          busy={approve.loading}
          onConfirm={() => void approve.run(confirming?.slug ?? null)}
          onCancel={() => setConfirming(undefined)}
        >
          <p>
            {confirming
              ? `You approve version ${event.version_no} of this geolocation in the name of ${confirming.name}.`
              : `You approve version ${event.version_no} of this geolocation.`}
          </p>
          <p>An approval is final: you cannot revoke it. A new version asks for a new approval.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The approvals a filed version (`/events/{id}/vN`) held, read-only. Absent when the version
 *  held none. */
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
