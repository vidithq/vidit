"use client";

import { useConfirmAction, ARM_MS } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  ROLE_LABEL,
  removeOrganizationMember,
  setOrganizationRole,
  type OrganizationMember,
} from "@/lib/organizations";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

interface MemberRowProps {
  slug: string;
  member: OrganizationMember;
  /** The signed-in analyst's username, null when anonymous. */
  viewer: string | null;
  canManage: boolean;
  /** The row is the organization's only org manager, whom the server never demotes or removes. */
  lastManager: boolean;
  onChanged: () => void;
}

/** One member: the byline, the role, and the controls the viewer holds over the row. A manager
 * flips the role and removes; anyone leaves from their own row. Removing and leaving take a
 * two-click confirm. The last org manager's row offers neither, and says why. */
function MemberRow({ slug, member, viewer, canManage, lastManager, onChanged }: MemberRowProps) {
  const username = member.user.username;
  const isSelf = viewer === username;
  const nextRole = member.role === "manager" ? "member" : "manager";

  const roleChange = useMutation(() => setOrganizationRole(slug, username, nextRole), {
    fallback: "Could not change the role",
    onSuccess: onChanged,
  });
  const removal = useMutation(() => removeOrganizationMember(slug, username), {
    fallback: isSelf ? "Could not leave" : "Could not remove",
    onSuccess: onChanged,
  });
  const {
    armed,
    trigger,
    controlRef: removeRef,
  } = useConfirmAction(() => removal.run().then(() => undefined), {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  const error = roleChange.error ?? removal.error;
  const busy = roleChange.loading || removal.loading;
  const removeLabel = isSelf ? "Leave" : "Remove";

  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm wrap-anywhere">
          <AuthorByline author={member.user} avatar className="min-w-0" />
          <Pill tone={member.role === "manager" ? "accent" : "neutral"}>
            {ROLE_LABEL[member.role]}
          </Pill>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {lastManager && (isSelf || canManage) && <FieldHelp concept="last_org_manager" />}
          {canManage && !lastManager && (
            <Button variant="ghost" onClick={() => void roleChange.run()} disabled={busy}>
              {nextRole === "manager" ? "Make org manager" : "Make member"}
            </Button>
          )}
          {(isSelf || canManage) && !lastManager && (
            <Button
              ref={removeRef}
              variant="danger"
              className={armed ? DANGER_CONFIRM : ""}
              onClick={trigger}
              disabled={busy}
            >
              {armed ? `Confirm ${removeLabel.toLowerCase()}` : removeLabel}
            </Button>
          )}
        </span>
      </div>
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
    </li>
  );
}

/** The organization's members, org managers first (the server's order). */
export function OrganizationMembers({
  slug,
  members,
  viewer,
  canManage,
  onChanged,
}: {
  slug: string;
  members: OrganizationMember[];
  viewer: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  // Mirrors backend organizations._guard_last_manager; change both.
  const managers = members.filter((m) => m.role === "manager").length;
  return (
    <Card as="section">
      <SectionEyebrow title="Members" margin="none" />
      <ul className="space-y-3">
        {members.map((member) => (
          <MemberRow
            key={member.user.id}
            slug={slug}
            member={member}
            viewer={viewer}
            canManage={canManage}
            lastManager={member.role === "manager" && managers === 1}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </Card>
  );
}
