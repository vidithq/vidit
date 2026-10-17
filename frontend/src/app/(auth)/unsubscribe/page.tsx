"use client";

import { TokenUnsubscribe, type TokenUnsubscribeCopy } from "@/components/auth/TokenUnsubscribe";
import { unsubscribeFromProductUpdates } from "@/lib/productUpdates";

const COPY: TokenUnsubscribeCopy = {
  title: "Unsubscribe from release emails",
  subtitle:
    "Stop the emails Vidit sends about each major release. Notification emails follow their own switches in Settings.",
  action: "Unsubscribe",
  pending: "Unsubscribing…",
  doneTitle: "You are unsubscribed",
  doneSubtitle:
    "Vidit sends you no more emails about major releases. Turn them back on in Settings at any time.",
};

/** The unsubscribe link of a product update email. */
export default function UnsubscribePage() {
  return <TokenUnsubscribe unsubscribe={unsubscribeFromProductUpdates} copy={() => COPY} />;
}
