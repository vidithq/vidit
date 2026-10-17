"use client";

import { TokenUnsubscribe, type TokenUnsubscribeCopy } from "@/components/auth/TokenUnsubscribe";
import {
  NOTIFICATION_KIND_COPY,
  unsubscribeFromNotificationEmail,
  unsubscribeTokenKind,
} from "@/lib/notifications";

/** The token also names the kind, so the page says which email it turns off. */
function copy(token: string): TokenUnsubscribeCopy {
  const kind = unsubscribeTokenKind(token);
  const label = kind ? `“${NOTIFICATION_KIND_COPY[kind].label}”` : "these notifications";
  return {
    title: "Turn off a notification email",
    subtitle: `Stop the emails Vidit sends for ${label}. The notifications still reach your Notifications page.`,
    action: "Turn off",
    pending: "Turning off…",
    doneTitle: "Email turned off",
    doneSubtitle: `Vidit sends no more emails for ${label}. They still reach your Notifications page, and Settings turns the email back on.`,
  };
}

/** Where a mail client that opens a notification email's List-Unsubscribe URL lands. */
export default function NotificationUnsubscribePage() {
  return <TokenUnsubscribe unsubscribe={unsubscribeFromNotificationEmail} copy={copy} />;
}
