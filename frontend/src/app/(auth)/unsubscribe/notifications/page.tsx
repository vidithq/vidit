"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useMutation } from "@/hooks/useMutation";
import {
  NOTIFICATION_KIND_COPY,
  unsubscribeFromNotificationEmail,
  unsubscribeTokenKind,
} from "@/lib/notifications";

/** Where a mail client that opens a notification email's List-Unsubscribe URL lands. It works
 *  without a session: the signed token names the account and the kind. A click confirms, so a
 *  mail scanner that opens the link turns nothing off. */
function UnsubscribeInner() {
  const token = useSearchParams().get("token") ?? "";
  const kind = unsubscribeTokenKind(token);
  const label = kind ? `“${NOTIFICATION_KIND_COPY[kind].label}”` : "these notifications";
  const [done, setDone] = useState(false);
  const unsubscribe = useMutation(() => unsubscribeFromNotificationEmail(token), {
    fallback: "This unsubscribe link is not valid.",
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <AuthCard
        title="Email turned off"
        subtitle={`Vidit sends no more emails for ${label}. They still reach your Notifications feed, and Settings turns the email back on.`}
      />
    );
  }

  return (
    <AuthCard
      title="Turn off a notification email"
      subtitle={`Stop the emails Vidit sends for ${label}. The notifications still reach your feed.`}
      footer={
        <Link href="/settings" className={TEXT_LINK}>
          Open Settings
        </Link>
      }
    >
      {unsubscribe.error && <div className={FORM_ERROR_BANNER}>{unsubscribe.error}</div>}
      <Button
        variant="primary"
        fullWidth
        disabled={!token || unsubscribe.loading}
        onClick={() => void unsubscribe.run()}
      >
        {unsubscribe.loading ? "Turning off…" : "Turn off"}
      </Button>
    </AuthCard>
  );
}

export default function NotificationUnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
