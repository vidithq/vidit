"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Stamp } from "lucide-react";

import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { ApiError } from "@/lib/api";
import {
  approvalsPath,
  approveEvent,
  approveOptions,
  changesSince,
  deleteApproval,
  type Approval,
  type ApprovalList,
} from "@/lib/approvals";
import { eventVersionHref, eventVersionPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import type { EventDetail, EventVersion } from "@/types";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Pill } from "@/components/ui/Pill";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TEXT_LINK } from "@/components/ui/styles";
import { profileHref } from "@/lib/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

export function ApprovalState({ approval }: { approval: Approval }) {
  if (approval.current) return <Pill tone="accent">Current</Pill>;
  return <Pill tone="neutral">Outdated</Pill>;
}

/** Who an approval speaks for, for the deletion dialog. */
function approvalSigner(approval: Approval): string {
  return approval.organization?.name ?? approval.reviewer?.username ?? "a deleted account";
}

function deleteErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.code === "approval_not_found") {
    return "This approval no longer exists. Reload the page to see the current list.";
  }
  if (err.status === 403) return "Only a site admin can delete an approval.";
  return undefined;
}

/** The [`ConfirmDialog`] of a site admin's delete: it says the deletion cannot be undone and that
 *  the reviewer can approve again. */
function DeleteApprovalDialog({
  approval,
  onDeleted,
  onCancel,
}: {
  approval: Approval;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const remove = useMutation(() => deleteApproval(approval.id), {
    fallback: "Failed to delete the approval",
    onError: deleteErrorMessage,
    onSuccess: onDeleted,
  });
  return (
    <ConfirmDialog
      title="Delete this approval?"
      confirmLabel="Delete approval"
      busyLabel="Deleting…"
      busy={remove.loading}
      error={remove.error}
      tone="danger"
      onConfirm={() => void remove.run()}
      onCancel={onCancel}
    >
      <p>{`You delete the approval of version ${approval.version_no} by ${approvalSigner(approval)}. This cannot be undone.`}</p>
      <p>The reviewer can approve this version again.</p>
    </ConfirmDialog>
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
 *  analyst's approval whose account was erased. Its label, the link's name and tooltip, reads
 *  *Bellingcat (maya) approved v2 on 15 Oct 2026*. */
function approvalStamp(approval: Approval): AvatarStackItem | null {
  const approved = `approved v${approval.version_no} on ${formatDate(approval.created_at)}`;
  if (approval.organization) {
    const org = organizationByline(approval.organization);
    const member = approval.reviewer ? ` (${approval.reviewer.username})` : "";
    return {
      key: approval.id,
      name: org.username,
      avatarUrl: org.avatar_url,
      variant: "organization",
      label: `${org.username}${member} ${approved}`,
      href: org.href,
    };
  }
  if (!approval.reviewer) return null;
  return {
    key: approval.id,
    name: approval.reviewer.username,
    avatarUrl: approval.reviewer.avatar_url,
    variant: "analyst",
    label: `${approval.reviewer.username} ${approved}`,
    href: profileHref(approval.reviewer.username),
  };
}

/** The given approvals, oldest first, as stamps that link to each signer's page, each with an
 *  accent check badge. Every stamp shows: no count of approvals shows anywhere. With `onDeleted`,
 *  a site admin gets a delete control on each stamp, which opens a confirmation. Renders nothing
 *  for an empty list. */
export function ApprovalStamps({
  approvals,
  onDeleted,
  trailing,
  className,
}: {
  approvals: Approval[];
  /** Runs after a site admin deleted an approval. */
  onDeleted?: () => void;
  /** After the last stamp, on its line (the `?`). */
  trailing?: ReactNode;
  className?: string;
}) {
  const { isAdmin } = useAdmin();
  const [deleting, setDeleting] = useState<Approval | null>(null);
  const deletable = isAdmin && onDeleted !== undefined;
  const items = approvals.flatMap((a) => {
    const stamp = approvalStamp(a);
    if (!stamp) return [];
    if (!deletable) return [stamp];
    return [
      {
        ...stamp,
        remove: {
          label: `Delete approval by ${approvalSigner(a)}`,
          onClick: () => setDeleting(a),
          confirms: true,
        },
      },
    ];
  });
  return (
    <>
      <AvatarStack
        items={items}
        label="Approved by"
        max={items.length}
        spacing="gap"
        checked
        trailing={trailing}
        className={className}
      />
      {deleting && onDeleted && (
        <DeleteApprovalDialog
          approval={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onDeleted();
          }}
        />
      )}
    </>
  );
}

/** The stamps with the `approval` help on the last stamp's line. From `lg` up every line aligns
 *  right, under the side column's right-aligned controls. Renders nothing for an empty list. */
export function ApprovedBy(props: ComponentProps<typeof ApprovalStamps>) {
  if (props.approvals.length === 0) return null;
  return (
    <ApprovalStamps
      {...props}
      trailing={<FieldHelp concept="approval" />}
      className="lg:justify-end"
    />
  );
}

/**
 * The approve control of the live version, for the actions row. The reader may approve as
 * themselves (an analyst outside the event's geolocators who has not approved it) and as each
 * organization they are a member of that has not approved it. With one of these identities it is
 * one **Approve** (or **Approve as <organization>**) button; with several, one **Approve** opens
 * an **Approve as** menu listing them. An approval is final, so a pick opens a confirmation step
 * naming the version (and the organization) before anything is sent. A stale version offers
 * **Reload**.
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

  const identities: (OrganizationRef | null)[] = [...(eligible ? [null] : []), ...organizations];
  const disabled = approve.loading || busy;

  return (
    <>
      {identities.length > 1 ? (
        <ActionMenu
          label="Approve as…"
          text="Approve"
          icon={<ChevronDown size={14} />}
          menuLabel="Approve as"
          variant="primary"
          disabled={disabled}
          items={identities.map((identity) => ({
            key: identity?.slug ?? "",
            label: identity?.name ?? user?.username ?? "You",
            icon: <Stamp size={14} />,
            onSelect: () => open(identity),
          }))}
        />
      ) : (
        identities.map((identity) => (
          <Button key={identity?.slug ?? ""} onClick={() => open(identity)} disabled={disabled}>
            <Stamp size={14} />
            {identity ? `Approve as ${identity.name}` : "Approve"}
          </Button>
        ))
      )}
      {approve.error && (
        <ErrorNotice error={approve.error} className="basis-full" />
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
          <p>An approval is final. A new version asks for a new approval.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The approvals a filed version (`/events/{id}/vN`) held, as stamps under the version selector,
 *  with a site admin's delete on each. Absent when the version held none. */
export function VersionApprovals({ event, versionNo }: { event: EventDetail; versionNo: number }) {
  const approvals = useApiResource<ApprovalList>(approvalsPath(event.id, versionNo));
  const rows = approvals.data?.items ?? [];
  if (rows.length === 0 && !approvals.error) return null;
  return (
    <section aria-label="Approvals" className="space-y-2">
      {rows.length > 0 && <ApprovedBy approvals={rows} onDeleted={approvals.refetch} />}
      {approvals.error && (
        <ErrorNotice error={approvals.error} />
      )}
    </section>
  );
}
