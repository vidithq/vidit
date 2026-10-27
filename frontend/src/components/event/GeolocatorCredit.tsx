"use client";

import type { EventDetail } from "@/types";
import { useMutation } from "@/hooks/useMutation";
import type { InviteAnswer } from "@/lib/geolocatorCredit";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/** **Accept** and **Decline** of an invitation, for a page's actions: siblings in the caller's
 *  wrapping row, with the error on a line of its own under them. */
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
    <>
      <Button onClick={() => void answer.run("accept")} disabled={answer.loading}>
        Accept
      </Button>
      <Button variant="ghost" onClick={() => void answer.run("decline")} disabled={answer.loading}>
        Decline
      </Button>
      {answer.error && (
        <div className={`${FORM_ERROR_BANNER} basis-full`} role="alert">
          {answer.error}
        </div>
      )}
    </>
  );
}

/** The event page's card for a reader the owner invited: what the invitation offers. The answer
 *  is in the actions row. */
export function GeolocatorInviteCard({ event }: { event: EventDetail }) {
  return (
    <Card as="section">
      <SectionEyebrow title="Geolocator invitation" margin="none" />
      <p className="text-sm text-neutral-300">
        <AuthorByline author={event.owner} prefix={false} /> invites you to share the credit of
        this geolocation. You are credited beside them; editing and closing stay with the owner.
        Accept or decline it at the top of the page.
      </p>
    </Card>
  );
}
