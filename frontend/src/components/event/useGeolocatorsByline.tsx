"use client";

import { useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";

import type { AuthorRef, EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  creditedAuthors,
  GEOLOCATOR_CAP_MESSAGE,
  geolocatorInvitesPath,
  inviteGeolocator,
  MAX_EVENT_GEOLOCATORS,
  removeGeolocator,
  withdrawGeolocatorInvite,
  type GeolocatorInvite,
} from "@/lib/geolocatorCredit";
import { profileHref } from "@/lib/routes";
import { suggestAuthors } from "@/lib/search";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { AuthorByline, BYLINE_GAP } from "@/components/ui/AuthorByline";
import { cn } from "@/lib/cn";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/AvatarStack";
import { Popover } from "@/components/ui/Popover";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

const ADD_LABEL = "Invite a geolocator";

type Person = { username: string; avatar_url?: string | null };

/** Why `name` cannot join a credit line, or null. `credited` starts with the reader, who owns
 *  the event. The local copies of the server's `already_geolocator`, `already_invited` and
 *  `too_many_geolocators` refusals, so a pick that cannot land never leaves the picker. */
function inviteRefusal(name: string, credited: string[], invited: string[]): string | null {
  if (name === credited[0]) return "You are already a geolocator of this event.";
  if (credited.includes(name)) return "This analyst is already a geolocator of this event.";
  if (invited.includes(name)) return "This analyst is already invited.";
  if (credited.length + invited.length >= MAX_EVENT_GEOLOCATORS) return GEOLOCATOR_CAP_MESSAGE;
  return null;
}

function picture(
  person: Person,
  label: string,
  remove: AvatarStackItem["remove"],
  muted = false,
  link = true,
): AvatarStackItem {
  return {
    key: person.username,
    name: person.username,
    avatarUrl: person.avatar_url,
    variant: "analyst",
    label,
    href: link ? profileHref(person.username) : undefined,
    remove,
    muted,
  };
}

/** The byline on one line: the owner, each co-geolocator and pending invitee as a picture with its
 *  remove disc, then the add button. Nothing opens in the page, so nothing moves. The pictures
 *  take the page byline's 20px and the add button stays within that line, so the line keeps the
 *  page byline's height. */
function BylineRow({
  owner,
  pictures,
  add,
}: {
  owner: AuthorRef;
  pictures: AvatarStackItem[];
  add: ReactNode;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center", BYLINE_GAP)}>
      <AuthorByline author={owner} avatar />
      {/* Every picture shows: the server caps the geolocators and invitations. */}
      <AvatarStack items={pictures} label="Co-geolocators" spacing="gap" size="sm" max={Infinity} />
      {add}
    </span>
  );
}

/** The add button: a popover holding the account picker. A pick that `onAdd` accepts closes it;
 *  a refusal prints under the field and keeps it open. */
function AddGeolocator({
  onAdd,
  error,
  note,
}: {
  onAdd: (account: Account) => boolean | Promise<boolean>;
  error: string | null;
  note: string;
}) {
  return (
    <Popover label={ADD_LABEL} icon={<UserPlus size={12} />} compact>
      {(close) => {
        // A local pick closes at once; an invitation once it lands.
        const pick = (account: Account) => {
          const added = onAdd(account);
          if (added === true) close();
          else if (added instanceof Promise) void added.then((ok) => ok && close());
        };
        return (
          <>
            <AccountPicker
              aria-label={ADD_LABEL}
              search={suggestAuthors}
              minQueryLength={2}
              onSelect={pick}
              onSubmitText={(name) => pick(analystAccount({ username: name }))}
              placeholder="Username"
              emptyText="No analyst with a published geolocation matches. Press Enter to invite this exact username."
              autoFocus
            />
            <p className="px-1 text-xs text-neutral-500">{note}</p>
            {error && (
              <ErrorNotice error={error} />
            )}
          </>
        );
      }}
    </Popover>
  );
}

/** A published edit's byline, for the owner: the credited geolocators, the pending invitations
 *  faded, the add button. Each change applies on click through its own endpoint and never makes a
 *  version. Removing a co-geolocator takes their credit, so its trash confirms in place;
 *  withdrawing an invitation is undone by inviting again, so its cross acts at once. */
export function GeolocatorsByline({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => void;
}) {
  const invites = useApiResource<GeolocatorInvite[]>(geolocatorInvitesPath(event.id));
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = useMutation(
    async (name: string) => {
      await inviteGeolocator(event.id, name);
      return true;
    },
    { fallback: "Failed to update the geolocators", onSuccess: () => invites.refetch() },
  );
  const change = useMutation(
    (kind: "remove" | "withdraw", name: string) =>
      kind === "remove" ? removeGeolocator(event.id, name) : withdrawGeolocatorInvite(event.id, name),
    {
      fallback: "Failed to update the geolocators",
      onSuccess: (_result, kind) => {
        invites.refetch();
        if (kind === "remove") onChanged();
      },
    },
  );
  const credited = creditedAuthors(event);
  const [, ...coGeolocators] = credited;
  const invite = async (account: Account): Promise<boolean> => {
    const name = accountName(account);
    const refused = inviteRefusal(
      name,
      credited.map((person) => person.username),
      (invites.data ?? []).map(({ user }) => user.username),
    );
    setRefusal(refused);
    if (refused) return false;
    return (await send.run(name)) ?? false;
  };
  const pictures = [
    ...coGeolocators.map((person) =>
      picture(person, person.username, {
        label: `Remove ${person.username}`,
        onClick: () => void change.run("remove", person.username),
        confirms: true,
      }),
    ),
    ...(invites.data ?? []).map(({ user }) =>
      picture(
        user,
        `${user.username}, invitation pending`,
        {
          label: `Withdraw the invitation of ${user.username}`,
          onClick: () => void change.run("withdraw", user.username),
        },
        true,
      ),
    ),
  ];
  return (
    <>
      <BylineRow
        owner={event.owner}
        pictures={pictures}
        add={
          <AddGeolocator
            onAdd={invite}
            error={refusal ?? send.error}
            note={`They are credited once they accept. Editing and closing stay with you. ${GEOLOCATOR_CAP_MESSAGE}`}
          />
        }
      />
      {change.error && <ErrorNotice error={change.error} className="mt-2" />}
    </>
  );
}

/**
 * A form that publishes (the submit form, a request's or a detection's publish form): the
 * reader's byline, since the reader owns the event once it is published, and the co-geolocators
 * they pick, faded until the publish invites them. Nothing is sent from the byline: `invitees`
 * are the picked usernames, which only the publish posts.
 */
export function useDraftGeolocatorsByline(): {
  byline: ReactNode;
  invitees: string[];
  /** The accounts picked so far, which the submit form's stored draft keeps. */
  picks: Account[];
  setPicks: (picks: Account[]) => void;
} {
  const { user } = useAuth();
  const [picked, setPicked] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = (account: Account) => {
    const name = accountName(account);
    // The reader owns the event once it is published, so they hold the first credit.
    const refused = inviteRefusal(name, user ? [user.username] : [], picked.map(accountName));
    setError(refused);
    if (refused) return false;
    setPicked([...picked, account]);
    return true;
  };
  const pictures = picked.map((account) => {
    const name = accountName(account);
    return picture(
      { username: name, avatar_url: account.avatar_url },
      `${name}, invited when you publish`,
      {
        label: `Remove ${name}`,
        onClick: () => setPicked(picked.filter((other) => accountName(other) !== name)),
      },
      true,
      false,
    );
  });
  return {
    byline: user && (
      <BylineRow
        owner={user}
        pictures={pictures}
        add={
          <AddGeolocator
            onAdd={add}
            error={error}
            note={`Invited when you publish the geolocation, credited once they accept. Publishing or saving a request invites no one. ${GEOLOCATOR_CAP_MESSAGE}`}
          />
        }
      />
    ),
    invitees: picked.map(accountName),
    picks: picked,
    setPicks: setPicked,
  };
}
