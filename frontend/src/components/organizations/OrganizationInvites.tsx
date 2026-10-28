"use client";

import { useState } from "react";
import { User } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  cancelOrganizationInvite,
  inviteToOrganization,
  organizationPath,
  type InviteCandidate,
  type OrganizationInvite,
} from "@/lib/organizations";
import { formatDate } from "@/lib/format";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LinkRow } from "@/components/ui/LinkRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { profileHref } from "@/lib/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The org manager's invite control and the pending invites.
 *
 * The picker lists only the analysts the server accepts: mutual follows of the viewer who are
 * neither members nor invited. The line under the heading says so, which is what explains an
 * analyst missing from the list. */
export function OrganizationInvites({ slug }: { slug: string }) {
  const base = organizationPath(slug);
  const candidates = useApiResource<InviteCandidate[]>(`${base}/invite-candidates`);
  const invites = useApiResource<OrganizationInvite[]>(`${base}/invites`);
  const [picked, setPicked] = useState<Account | null>(null);

  const refresh = () => {
    candidates.refetch();
    invites.refetch();
  };

  const send = useMutation((invitee: Account) => inviteToOrganization(slug, accountName(invitee)), {
    fallback: "Could not send the invite",
    onSuccess: () => {
      setPicked(null);
      refresh();
    },
  });
  const cancel = useMutation((username: string) => cancelOrganizationInvite(slug, username), {
    fallback: "Could not withdraw the invite",
    onSuccess: refresh,
  });

  const options = (candidates.data ?? []).map(analystAccount);
  const pending = invites.data ?? [];
  const error = send.error ?? cancel.error ?? invites.error ?? candidates.error;

  return (
    <Card as="section">
      <header className="space-y-1">
        <SectionEyebrow title="Invites" margin="none" />
        <p className="text-xs text-neutral-500">
          You can invite an analyst who follows you and whom you follow. They join once they
          accept.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (picked) void send.run(picked);
        }}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
      >
        <div>
          <label className={FORM_LABEL} htmlFor="invite-candidate">
            Analyst
          </label>
          <div className="mt-1">
            <AccountPicker
              id="invite-candidate"
              options={options}
              selected={picked}
              onSelect={setPicked}
              onClear={() => setPicked(null)}
              placeholder="Pick an analyst"
              emptyText={
                candidates.data?.length === 0
                  ? "No mutual follow to invite"
                  : "No mutual follow matches"
              }
            />
          </div>
        </div>
        <Button type="submit" variant="secondary" disabled={!picked || send.loading}>
          {send.loading ? "Inviting…" : "Invite"}
        </Button>
      </form>

      {error && <ErrorNotice error={error} />}

      {pending.length === 0 ? (
        <p className="text-xs text-neutral-500">No pending invite.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((invite) => (
            <li key={invite.user.id}>
              <LinkRow
                variant="arrow"
                icon={User}
                leading={
                  <Avatar
                    src={invite.user.avatar_url}
                    username={invite.user.username}
                    size="size-7"
                    decorative
                  />
                }
                value={invite.user.username}
                meta={
                  <span>
                    Invited {formatDate(invite.invited_at)}
                    {invite.invited_by ? ` by ${invite.invited_by.username}` : ""}
                  </span>
                }
                href={profileHref(invite.user.username)}
                external={false}
                action={
                  <Button
                    variant="ghost"
                    onClick={() => void cancel.run(invite.user.username)}
                    disabled={cancel.loading}
                  >
                    Withdraw
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
