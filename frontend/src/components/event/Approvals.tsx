"use client";

import { useState, type ReactNode } from "react";
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
  standingApprovalBefore,
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

/** `closed` marks a standing approval of a closed event's last version: not current, since the
 *  claim it attests was taken back, and not outdated by a newer version either. */
export function ApprovalState({ approval, closed = false }: { approval: Approval; closed?: boolean }) {
  if (approval.revoked_at) return <Pill tone="danger">Revoked</Pill>;
  if (approval.current) return <Pill tone="accent">Current</Pill>;
  if (closed) return <Pill tone="neutral">Event closed</Pill>;
  return <Pill tone="neutral">Outdated</Pill>;
}

/** One review: who placed it (an organization signs with its name, its acting org manager
 *  beside it, or "on behalf of" it once that account is erased) and when, its note, and, once
 *  revoked, the public reason. */
export function ApprovalRow({
  approval,
  onRevoke,
  showVersion = false,
  closed = false,
}: {
  approval: Approval;
  onRevoke?: () => void;
  /** Print the version it covers, for a list that mixes versions. */
  showVersion?: boolean;
  /** See `ApprovalState`. */
  closed?: boolean;
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
          <ApprovalState approval={approval} closed={closed} />
          <span className="text-[11px] text-neutral-500">
            {showVersion && `Version ${approval.version_no}, `}
            {formatDate(approval.created_at)}
          </span>
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


/** What a stamp opens: the signer's picture and name, the version and date, the note, who acted
 *  for an organization, and the way to the profile or the organization's page. */
function StampCard({
  approval,
  signer,
}: {
  approval: Approval;
  signer: { username: string; avatar_url?: string | null; href: string };
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
      <Link href={signer.href} className={TEXT_LINK}>
        {approval.organization ? "View organization" : "View profile"}
      </Link>
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

/** One current approval as a stamp: the organization's square or the analyst's circle, opening
 *  its card. */
function approvalStamp(approval: Approval): AvatarStackItem | null {
  const signer = approvalSigner(approval);
  if (!signer) return null;
  return {
    key: approval.id,
    name: signer.username,
    avatarUrl: signer.avatar_url,
    variant: approval.organization ? "organization" : "analyst",
    label: `Approved by ${signer.username}`,
    renderCard: () => <StampCard approval={approval} signer={signer} />,
  };
}

/** The current approvals of the event, oldest first, as stamps. Renders nothing while none
 *  stands. */
export function ApprovalStamps({
  approvals,
  onOverflow,
}: {
  /** Every version's approvals, by version then oldest first. */
  approvals: Approval[];
  onOverflow: () => void;
}) {
  return (
    <AvatarStack
      items={approvals.flatMap((a) => (a.current ? (approvalStamp(a) ?? []) : []))}
      label="Approved by"
      onOverflow={onOverflow}
      overflowLabel={(hidden) => `Show ${hidden} more approvals`}
    />
  );
}

const REVOKE_FIELD_ID = "approval-revoke-reason";
/** The approve form's note field, which the event header's approve button focuses. */
export const APPROVAL_NOTE_FIELD_ID = "approval-note";

interface ApprovalGroup {
  key: string;
  title?: string;
  rows: Approval[];
  /** Said in place of the rows when there are none. */
  empty?: string;
  footer?: ReactNode;
  showVersion?: boolean;
  closed?: boolean;
}

/**
 * Lists of reviews under optional headings, each review with its own **Revoke** for the reviewer,
 * an org manager of the organization it speaks for, or a site admin. Revoking opens an inline
 * reason field; the reason is public.
 */
function ApprovalGroups({
  eventId,
  groups,
  managed,
  onRevoked,
}: {
  eventId: string;
  groups: ApprovalGroup[];
  managed: OrganizationRef[];
  onRevoked: () => void;
}) {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const revoke = useMutation(() => revokeApproval(eventId, revoking!, reason.trim()), {
    fallback: "Failed to revoke the approval",
    onSuccess: () => {
      setRevoking(null);
      setReason("");
      onRevoked();
    },
  });

  const managedSlugs = new Set(managed.map((o) => o.slug));
  // Mirrors backend approvals._revoker_role; change both.
  const mayRevoke = (approval: Approval) =>
    !approval.revoked_at &&
    (isAdmin ||
      (approval.organization
        ? managedSlugs.has(approval.organization.slug)
        : approval.reviewer?.id === user?.id));

  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1">
          {group.title && <SectionEyebrow as="h3" title={group.title} margin="none" />}
          {group.rows.length > 0 ? (
            <div className="divide-y divide-neutral-800">
              {group.rows.map((approval) => (
                <div key={approval.id}>
                  <ApprovalRow
                    approval={approval}
                    showVersion={group.showVersion}
                    closed={group.closed}
                    onRevoke={
                      mayRevoke(approval) && revoking !== approval.id
                        ? () => {
                            revoke.reset();
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
                          onClick={() => void revoke.run()}
                          disabled={revoke.loading || !reason.trim()}
                        >
                          Revoke approval
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setRevoking(null)}
                          disabled={revoke.loading}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            group.empty && <p className="text-sm text-neutral-500">{group.empty}</p>
          )}
          {group.footer}
        </div>
      ))}
      {revoke.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {revoke.error}
        </div>
      )}
    </>
  );
}

/**
 * The approve control of the live version: an optional note, **Approve version N** for an analyst
 * outside the event's geolocators who has not reviewed it, and one **Approve as <organization>**
 * per organization the reader manages whose approval of it does not stand. Above it, what
 * changed since the latest earlier version the reader approved.
 */
export function ApproveForm({
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
  const approvedVersion = eligible
    ? standingApprovalBefore(
        approvals.items.filter((a) => !a.organization && a.reviewer?.id === user?.id),
        event.version_no,
      )
    : null;

  return (
    <div className="space-y-2">
      {approvedVersion !== null && (
        <ChangesSinceApproval eventId={event.id} event={event} approvedVersion={approvedVersion} />
      )}
      <label htmlFor={APPROVAL_NOTE_FIELD_ID} className={FORM_LABEL}>
        Note (optional)
      </label>
      <Textarea
        id={APPROVAL_NOTE_FIELD_ID}
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

/** The approvals of an event sorted the way the Verification card reads them. A closed event
 *  keeps its approvals readable, none of them current (the server's `current`). */
export function approvalTally(event: EventDetail, rows: Approval[]) {
  return {
    closed: event.status !== "geolocated",
    current: rows.filter((a) => a.current),
    live: rows.filter((a) => a.version_no === event.version_no && !a.revoked_at),
    outdatedVersions: [
      ...new Set(
        rows
          .filter((a) => !a.current && !a.revoked_at && a.version_no < event.version_no)
          .map((a) => a.version_no),
      ),
    ].sort((a, b) => b - a),
    revoked: rows.filter((a) => a.revoked_at).sort((a, b) => b.version_no - a.version_no),
  };
}

/**
 * Every approval of the event in groups: the live version's standing approvals, the outdated ones
 * by version (newest first, each with what changed since), and the revoked ones with their public
 * reason. Each row carries **Revoke** for whoever may revoke it.
 */
export function ApprovalHistory({
  event,
  rows,
  managed,
  onRevoked,
}: {
  event: EventDetail;
  /** Every version's approvals. */
  rows: Approval[];
  managed: OrganizationRef[];
  onRevoked: () => void;
}) {
  const { closed, live, outdatedVersions, revoked } = approvalTally(event, rows);
  const groups: ApprovalGroup[] = [
    closed
      ? {
          key: "closed",
          title: `Version ${event.version_no}, event closed`,
          rows: live,
          empty: "No approval stood when the event closed.",
          closed: true,
        }
      : {
          key: "current",
          title: `Version ${event.version_no}, current`,
          rows: live,
          empty: "No current approval yet.",
        },
    ...outdatedVersions.map((version) => ({
      key: `v${version}`,
      title: `Version ${version}, outdated`,
      rows: rows.filter((a) => a.version_no === version && !a.revoked_at),
      footer: (
        <ChangesSinceApproval
          eventId={event.id}
          event={event}
          approvedVersion={version}
          approver="they"
        />
      ),
    })),
    ...(revoked.length > 0
      ? [{ key: "revoked", title: "Revoked", rows: revoked, showVersion: true }]
      : []),
  ];
  return (
    <ApprovalGroups eventId={event.id} groups={groups} managed={managed} onRevoked={onRevoked} />
  );
}

/** The reviews a filed version (`/events/{id}/vN`) held, read-only but for **Revoke**. Absent
 *  when the version held none. */
export function VersionApprovals({ event, versionNo }: { event: EventDetail; versionNo: number }) {
  const managed = useManagedOrganizations();
  const approvals = useApiResource<ApprovalList>(approvalsPath(event.id, versionNo));
  const rows = approvals.data?.items ?? [];
  if (rows.length === 0 && !approvals.error) return null;
  return (
    <Card as="section">
      <SectionEyebrow title="Approvals" margin="none" />
      <ApprovalGroups
        eventId={event.id}
        groups={[{ key: "version", rows }]}
        managed={managed}
        onRevoked={approvals.refetch}
      />
      {approvals.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {approvals.error}
        </div>
      )}
    </Card>
  );
}
