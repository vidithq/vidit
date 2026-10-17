"use client";

import { useState, type FormEvent } from "react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  answerGeolocatorInvite,
  creditedAuthors,
  geolocatorInvitesPath,
  inviteGeolocator,
  removeGeolocator,
  withdrawGeolocatorInvite,
  type GeolocatorInvite,
} from "@/lib/geolocatorCredit";
import { suggestAuthors } from "@/lib/search";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

/**
 * The invitee's answer to an invitation to share an event's credit: the notification row and the
 * event page both render it. Accepting adds the reader to the event's geolocators; declining drops
 * the invitation.
 */
export function InviteAnswerButtons({
  eventId,
  onAnswered,
}: {
  eventId: string;
  onAnswered: () => void;
}) {
  const answer = useMutation(
    (verb: "accept" | "decline") => answerGeolocatorInvite(eventId, verb),
    { fallback: "Failed to answer the invitation", onSuccess: onAnswered },
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void answer.run("accept")} disabled={answer.loading}>
          Accept
        </Button>
        <Button
          variant="ghost"
          onClick={() => void answer.run("decline")}
          disabled={answer.loading}
        >
          Decline
        </Button>
      </div>
      {answer.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {answer.error}
        </div>
      )}
    </div>
  );
}

/** The event page's card for a reader the owner invited. */
export function GeolocatorInviteCard({
  event,
  onAnswered,
}: {
  event: EventDetail;
  onAnswered: () => void;
}) {
  return (
    <Card as="section">
      <SectionEyebrow title="Geolocator invitation" margin="none" />
      <p className="text-sm text-neutral-300">
        <AuthorByline author={event.owner} prefix={false} /> invites you to share the credit of
        this geolocation. You are credited beside them; editing and closing stay with the owner.
      </p>
      <InviteAnswerButtons eventId={event.id} onAnswered={onAnswered} />
    </Card>
  );
}

/** One credited or invited analyst, with the one verb the reader holds over that row. */
function CreditRow({
  author,
  action,
}: {
  author: { username: string; avatar_url?: string | null };
  action?: { label: string; run: () => void; disabled: boolean };
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <AuthorByline author={author} avatar className="text-sm min-w-0" />
      {action && (
        <Button variant="ghost" onClick={action.run} disabled={action.disabled}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

const INVITE_FIELD_ID = "geolocator-invite-username";

/**
 * The geolocators of a published event. The owner invites an analyst picked by username, withdraws a
 * pending invitation and removes a co-geolocator; a co-geolocator sees the same list and can
 * leave. Credit grants no edit right, so nothing else here acts on the event.
 */
export function GeolocatorsPanel({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const isOwner = user?.id === event.owner.id;
  const invites = useApiResource<GeolocatorInvite[]>(
    isOwner ? geolocatorInvitesPath(event.id) : null,
  );
  const [invitee, setInvitee] = useState<Account | null>(null);

  const write = useMutation(
    (kind: "invite" | "withdraw" | "remove", name: string) => {
      if (kind === "invite") return inviteGeolocator(event.id, name).then(() => undefined);
      if (kind === "withdraw") return withdrawGeolocatorInvite(event.id, name);
      return removeGeolocator(event.id, name);
    },
    {
      fallback: "Failed to update the geolocators",
      onSuccess: (_result, kind) => {
        if (kind === "invite") setInvitee(null);
        invites.refetch();
        if (kind === "remove") onChanged();
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invitee) void write.run("invite", accountName(invitee));
  };

  const rowAction = (name: string) => {
    if (name === event.owner.username) return undefined;
    if (isOwner) {
      return { label: "Remove", run: () => void write.run("remove", name), disabled: write.loading };
    }
    if (name === user?.username) {
      return { label: "Leave", run: () => void write.run("remove", name), disabled: write.loading };
    }
    return undefined;
  };

  return (
    <div className="space-y-4">
      <div className="divide-y divide-neutral-800">
        {creditedAuthors(event).map((author) => (
          <CreditRow key={author.id} author={author} action={rowAction(author.username)} />
        ))}
      </div>

      {isOwner && invites.data && invites.data.length > 0 && (
        <div>
          <span className={FORM_LABEL}>Pending invitations</span>
          <div className="divide-y divide-neutral-800">
            {invites.data.map((invite) => (
              <CreditRow
                key={invite.user.id}
                author={invite.user}
                action={{
                  label: "Withdraw",
                  run: () => void write.run("withdraw", invite.user.username),
                  disabled: write.loading,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {isOwner && (
        <form onSubmit={submit} className="space-y-1.5">
          <label htmlFor={INVITE_FIELD_ID} className={FORM_LABEL}>
            Invite a geolocator
          </label>
          <div className="flex items-center gap-2">
            <AccountPicker
              id={INVITE_FIELD_ID}
              search={suggestAuthors}
              minQueryLength={2}
              selected={invitee}
              onSelect={setInvitee}
              onSubmitText={(name) => setInvitee(analystAccount({ username: name }))}
              onClear={() => setInvitee(null)}
              placeholder="Username"
              emptyText="No analyst with a published geolocation matches. Press Enter to invite this exact username."
            />
            <Button type="submit" disabled={write.loading || !invitee}>
              Invite
            </Button>
          </div>
        </form>
      )}

      {(write.error || invites.error) && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {write.error ?? invites.error}
        </div>
      )}
    </div>
  );
}
