"use client";

import type { EventDetail } from "@/types";
import { useMutation } from "@/hooks/useMutation";
import {
  answerGeolocatorInvite,
  type InviteAnswer,
} from "@/lib/geolocatorCredit";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
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
