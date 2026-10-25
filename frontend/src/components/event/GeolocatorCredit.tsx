"use client";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  answerGeolocatorInvite,
  creditedAuthors,
  removeGeolocator,
  type InviteAnswer,
} from "@/lib/geolocatorCredit";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

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

/** One credited analyst. The reader's own row carries **Leave**, which takes their credit away,
 * so it arms in place: the first click turns the button into its confirm, and the second runs
 * it. */
function CreditRow({
  author,
  leave,
}: {
  author: { username: string; avatar_url?: string | null };
  leave?: { run: () => void; disabled: boolean };
}) {
  const { armed, trigger, controlRef } = useConfirmAction(() => leave?.run(), {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <AuthorByline author={author} avatar className="text-sm min-w-0" />
      {leave && (
        <Button
          ref={controlRef}
          variant="danger"
          className={armed ? DANGER_CONFIRM : ""}
          onClick={trigger}
          disabled={leave.disabled}
        >
          {armed ? "Confirm leave" : "Leave"}
        </Button>
      )}
    </div>
  );
}

/** The event page's Geolocators panel for a co-geolocator, under its titled card. The owner
 *  manages the geolocators from the edit page's byline (`GeolocatorsByline`). */
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

/**
 * The geolocators of a published event, owner first, as a co-geolocator reads them, with
 * **Leave** on their own row. Credit grants no edit right, so nothing else here acts on the
 * event.
 */
export function GeolocatorsPanel({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const leave = useMutation((name: string) => removeGeolocator(event.id, name), {
    fallback: "Failed to update the geolocators",
    onSuccess: onChanged,
  });
  return (
    <div className="space-y-4">
      <div className="divide-y divide-neutral-800">
        {creditedAuthors(event).map((author) => (
          <CreditRow
            key={author.id}
            author={author}
            leave={
              author.username === user?.username && author.id !== event.owner.id
                ? { run: () => void leave.run(author.username), disabled: leave.loading }
                : undefined
            }
          />
        ))}
      </div>
      {leave.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {leave.error}
        </div>
      )}
    </div>
  );
}
