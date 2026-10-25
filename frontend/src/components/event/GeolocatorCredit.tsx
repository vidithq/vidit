"use client";

import { useState, type FormEvent } from "react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  answerGeolocatorInvite,
  creditedAuthors,
  geolocatorInvitesPath,
  inviteGeolocator,
  removeGeolocator,
  withdrawGeolocatorInvite,
  type GeolocatorInvite,
  type InviteAnswer,
} from "@/lib/geolocatorCredit";
import { suggestAuthors } from "@/lib/search";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

export function InviteAnswerButtons({
  answer: post,
  onAnswered,
}: {
  answer: (choice: InviteAnswer) => Promise<unknown>;
  onAnswered: () => void;
}) {
  const answer = useMutation(post, {
    fallback: "Failed to answer the invitation",
    onSuccess: onAnswered,
  });
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
      <InviteAnswerButtons
        answer={(choice) => answerGeolocatorInvite(event.id, choice)}
        onAnswered={onAnswered}
      />
    </Card>
  );
}

type RowAuthor = { username: string; avatar_url?: string | null };

/** One credited or invited analyst, with the one verb the reader holds over that row. Each verb
 * takes a credit away (Remove, Leave, Withdraw), so it arms in place: the first click turns the
 * button into its confirm, and the second runs it. A draft's pick, which nothing has sent yet,
 * goes on the first click (`confirm: false`). */
function CreditRow({
  author,
  action,
}: {
  author: RowAuthor;
  action?: { label: string; run: () => void; disabled: boolean; confirm?: boolean };
}) {
  const { armed, trigger, controlRef } = useConfirmAction(() => action?.run(), {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <AuthorByline author={author} avatar className="text-sm min-w-0" />
      {action && (
        <Button
          ref={controlRef}
          variant="danger"
          className={armed ? DANGER_CONFIRM : ""}
          onClick={action.confirm === false ? action.run : trigger}
          disabled={action.disabled}
        >
          {armed ? `Confirm ${action.label.toLowerCase()}` : action.label}
        </Button>
      )}
    </div>
  );
}

/** The geolocators panel under its titled card: the event page's panel for a co-geolocator, a
 *  published edit's panel for the owner. */
export function GeolocatorsCard({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => void;
}) {
  return (
    <Card as="section">
      <SectionEyebrow title="Geolocators" concept="geolocators" margin="none" />
      <GeolocatorsPanel event={event} onChanged={onChanged} />
    </Card>
  );
}

const INVITE_FIELD_ID = "geolocator-invite-username";

/** The owner's invite field: an analyst picked in an `AccountPicker`, then **Invite**. The pick
 *  clears once `onInvite` resolves true. */
function InviteField({
  onInvite,
  disabled,
}: {
  onInvite: (invitee: Account) => boolean | Promise<boolean>;
  disabled: boolean;
}) {
  const [invitee, setInvitee] = useState<Account | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (invitee && (await onInvite(invitee))) setInvitee(null);
  };
  return (
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
        <Button type="submit" variant="secondary" disabled={disabled || !invitee}>
          Invite
        </Button>
      </div>
    </form>
  );
}

function PendingInvitations({
  people,
  action,
}: {
  people: RowAuthor[];
  action: (person: RowAuthor) => NonNullable<Parameters<typeof CreditRow>[0]["action"]>;
}) {
  if (people.length === 0) return null;
  return (
    <div>
      <span className={FORM_LABEL}>Pending invitations</span>
      <div className="divide-y divide-neutral-800">
        {people.map((person) => (
          <CreditRow key={person.username} author={person} action={action(person)} />
        ))}
      </div>
    </div>
  );
}

/**
 * The geolocators of an event not yet published, on the submit form and on the publish form of a
 * request or a detection: the reader, who owns the event once it is published, then the analysts
 * they pick. Nothing is sent here: the publish posts the picks, and a request's own writes post
 * none (the `geolocators_draft` help says so).
 */
export function DraftGeolocatorsCard({
  author,
  invitees,
  onChange,
}: {
  author: RowAuthor;
  invitees: Account[];
  onChange: (invitees: Account[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // A refused pick clears too: the name itself is what the card refuses.
  const add = (invitee: Account) => {
    const name = accountName(invitee);
    if (name === author.username) setError("You are already a geolocator of this event.");
    else if (invitees.some((picked) => accountName(picked) === name)) {
      setError("This analyst is already invited.");
    } else {
      setError(null);
      onChange([...invitees, invitee]);
    }
    return true;
  };
  return (
    <Card as="section">
      <SectionEyebrow title="Geolocators" concept="geolocators_draft" margin="none" />
      <div className="space-y-4">
        <div className="divide-y divide-neutral-800">
          <CreditRow author={author} />
        </div>
        <PendingInvitations
          people={invitees.map((invitee) => ({
            username: accountName(invitee),
            avatar_url: invitee.avatar_url,
          }))}
          action={(person) => ({
            label: "Remove",
            confirm: false,
            disabled: false,
            run: () => onChange(invitees.filter((picked) => accountName(picked) !== person.username)),
          })}
        />
        <InviteField onInvite={add} disabled={false} />
        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}

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

  const write = useMutation(
    async (kind: "invite" | "withdraw" | "remove", name: string) => {
      if (kind === "invite") await inviteGeolocator(event.id, name);
      else if (kind === "withdraw") await withdrawGeolocatorInvite(event.id, name);
      else await removeGeolocator(event.id, name);
      return true;
    },
    {
      fallback: "Failed to update the geolocators",
      onSuccess: (_result, kind) => {
        invites.refetch();
        if (kind === "remove") onChanged();
      },
    },
  );

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

      {isOwner && invites.data && (
        <PendingInvitations
          people={invites.data.map((invite) => invite.user)}
          action={(person) => ({
            label: "Withdraw",
            run: () => void write.run("withdraw", person.username),
            disabled: write.loading,
          })}
        />
      )}

      {isOwner && (
        <InviteField
          onInvite={async (invitee) =>
            (await write.run("invite", accountName(invitee))) ?? false
          }
          disabled={write.loading}
        />
      )}

      {(write.error || invites.error) && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {write.error ?? invites.error}
        </div>
      )}
    </div>
  );
}
