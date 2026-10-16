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
import { Avatar } from "@/components/ui/Avatar";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/AvatarStack";
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

/** What a stamp opens: the signer's picture and name, the version and date, the note, who acted
 *  for an organization, the way to the profile or the organization's page, and **Revoke** for
 *  whoever may revoke it. */
function StampCard({
  approval,
  signer,
  onRevoke,
}: {
  approval: Approval;
  signer: { username: string; avatar_url?: string | null; href: string };
  onRevoke?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Avatar
          src={signer.avatar_url}
          username={signer.username}
          size="size-10 text-sm"
          shape={approval.organization ? "square" : "circle"}
          decorative
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-100 [overflow-wrap:anywhere]">
            {signer.username}
          </p>
          <p className="text-neutral-500">
            Version {approval.version_no} · {formatDate(approval.created_at)}
          </p>
        </div>
      </div>
      {approval.organization && (
        <p className="text-neutral-400 [overflow-wrap:anywhere]">
          {approval.reviewer ? `${approval.reviewer.username} ` : ""}on behalf of{" "}
          {approval.organization.name}
        </p>
      )}
      {approval.note && (
        <p className="line-clamp-4 text-neutral-300 [overflow-wrap:anywhere]">{approval.note}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Link href={signer.href} className={TEXT_LINK}>
          {approval.organization ? "View organization" : "View profile"}
        </Link>
        {onRevoke && (
          <Button variant="dangerGhost" onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}

/** Who signs an approval: the organization it speaks for, or the reviewer; null for an analyst's
 *  approval whose account was erased. */
export function approvalSigner(
  approval: Approval,
): { username: string; avatar_url?: string | null; href: string } | null {
  if (approval.organization) return organizationByline(approval.organization);
  return approval.reviewer && { ...approval.reviewer, href: `/profile/${approval.reviewer.username}` };
}

/** Whether the reader may revoke an approval: the reviewer, an org manager of the organization
 *  it speaks for, or a site admin. Mirrors backend approvals._revoker_role; change both. */
function useMayRevoke(managed: OrganizationRef[]): (approval: Approval) => boolean {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const managedSlugs = new Set(managed.map((o) => o.slug));
  return (approval) =>
    !approval.revoked_at &&
    (isAdmin ||
      (approval.organization
        ? managedSlugs.has(approval.organization.slug)
        : approval.reviewer?.id === user?.id));
}

/**
 * The given approvals, oldest first, as stamps. Renders nothing for an empty list. With
 * `managed`, a stamp's card offers **Revoke** to whoever may revoke that approval.
 */
export function ApprovalStamps({
  approvals,
  max,
  onOverflow,
  managed,
  onRevoke,
}: {
  approvals: Approval[];
  max?: number;
  onOverflow?: () => void;
  managed?: OrganizationRef[];
  onRevoke?: (approval: Approval) => void;
}) {
  const mayRevoke = useMayRevoke(managed ?? []);
  const stamp = (approval: Approval): AvatarStackItem | null => {
    const signer = approvalSigner(approval);
    if (!signer) return null;
    const revoke = onRevoke && mayRevoke(approval) ? () => onRevoke(approval) : undefined;
    return {
      key: approval.id,
      name: signer.username,
      avatarUrl: signer.avatar_url,
      variant: approval.organization ? "organization" : "analyst",
      label: `Approved by ${signer.username}`,
      renderCard: () => <StampCard approval={approval} signer={signer} onRevoke={revoke} />,
    };
  };
  return (
    <AvatarStack
      items={approvals.flatMap((a) => stamp(a) ?? [])}
      label="Approved by"
      max={max}
      onOverflow={onOverflow}
      overflowLabel={(hidden) => `Show ${hidden} more approvals`}
    />
  );
}

const REVOKE_FIELD_ID = "approval-revoke-reason";
const NOTE_FIELD_ID = "approval-note";

/** The reason field that revokes one approval. The reason is public. */
export function RevokeForm({
  eventId,
  approval,
  onRevoked,
  onCancel,
}: {
  eventId: string;
  approval: Approval;
  onRevoked: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const revoke = useMutation(() => revokeApproval(eventId, approval.id, reason.trim()), {
    fallback: "Failed to revoke the approval",
    onSuccess: onRevoked,
  });
  const signer = approvalSigner(approval);
  return (
    <div className="space-y-2">
      <label htmlFor={REVOKE_FIELD_ID} className={FORM_LABEL}>
        {signer ? `Revoke the approval by ${signer.username}: reason` : "Reason"}, shown publicly
        on the approval
      </label>
      <Textarea
        id={REVOKE_FIELD_ID}
        autoFocus
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="danger"
          onClick={() => void revoke.run()}
          disabled={revoke.loading || !reason.trim()}
        >
          Revoke approval
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={revoke.loading}>
          Cancel
        </Button>
      </div>
      {revoke.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {revoke.error}
        </div>
      )}
    </div>
  );
}

/**
 * The approve control of the live version: an optional note, **Approve version N** for an analyst
 * outside the event's geolocators who has not reviewed it, and one **Approve as <organization>**
 * per organization the reader manages whose approval of it does not stand. It opens from
 * **Approve** and takes focus on its note; **Cancel** closes it.
 */
export function ApproveForm({
  event,
  approvals,
  managed,
  onApproved,
  onCancel,
}: {
  event: EventDetail;
  approvals: ApprovalList;
  managed: OrganizationRef[];
  onApproved: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [note, setNote] = useState("");
  // The list an approval landed on: the buttons hold until the refetch replaces it, or a quick
  // second click would answer 409.
  const [approvedOn, setApprovedOn] = useState<ApprovalList | null>(null);
  const busy = approvedOn === approvals;
  const approve = useMutation(
    (organization: string | null) =>
      approveEvent(event.id, event.version_no, note, organization ?? undefined),
    {
      fallback: "Failed to approve",
      onSuccess: () => {
        setNote("");
        setApprovedOn(approvals);
        onApproved();
      },
    },
  );

  const { eligible, organizations: forOrganizations } = approveOptions(
    event,
    approvals,
    managed,
    user?.id,
  );
  if (!eligible && forOrganizations.length === 0) return null;

  return (
    <div className="space-y-2">
      <label htmlFor={NOTE_FIELD_ID} className={FORM_LABEL}>
        Note (optional)
      </label>
      <Textarea
        id={NOTE_FIELD_ID}
        autoFocus
        rows={2}
        maxLength={APPROVAL_NOTE_MAX_LEN}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {eligible && (
          <Button onClick={() => void approve.run(null)} disabled={approve.loading || busy}>
            {approveLabel(event.version_no)}
          </Button>
        )}
        {forOrganizations.map((organization) => (
          <Button
            key={organization.slug}
            variant={eligible ? "secondary" : "primary"}
            onClick={() => void approve.run(organization.slug)}
            disabled={approve.loading || busy}
          >
            Approve as {organization.name}
          </Button>
        ))}
        <Button variant="ghost" onClick={onCancel} disabled={approve.loading}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-neutral-500">
        An approval covers this version only. A new version asks you, or the
        organization&apos;s org managers, to approve again.
      </p>
      {approve.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {approve.error}
        </div>
      )}
    </div>
  );
}

/** The reviews a filed version (`/events/{id}/vN`) held, outdated and revoked alike, each revoked
 *  one with its public reason, read-only but for **Revoke**. Absent when the version held none. */
export function VersionApprovals({ event, versionNo }: { event: EventDetail; versionNo: number }) {
  const managed = useManagedOrganizations();
  const mayRevoke = useMayRevoke(managed);
  const approvals = useApiResource<ApprovalList>(approvalsPath(event.id, versionNo));
  const [revoking, setRevoking] = useState<string | null>(null);
  const rows = approvals.data?.items ?? [];
  if (rows.length === 0 && !approvals.error) return null;
  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      <div className="divide-y divide-neutral-800">
        {rows.map((approval) => (
          <div key={approval.id}>
            <ApprovalRow
              approval={approval}
              onRevoke={
                mayRevoke(approval) && revoking !== approval.id
                  ? () => setRevoking(approval.id)
                  : undefined
              }
            />
            {revoking === approval.id && (
              <div className="pb-2">
                <RevokeForm
                  eventId={event.id}
                  approval={approval}
                  onRevoked={() => {
                    setRevoking(null);
                    approvals.refetch();
                  }}
                  onCancel={() => setRevoking(null)}
                />
              </div>
            )}
          </div>
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
