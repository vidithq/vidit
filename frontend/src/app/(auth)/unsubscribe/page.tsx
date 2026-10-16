"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { useMutation } from "@/hooks/useMutation";
import { unsubscribeFromProductUpdates } from "@/lib/productUpdates";

/** The unsubscribe link of a product update email. It works without a session: the signed token
 *  names the account. A click confirms, so a mail scanner that opens the link withdraws nothing;
 *  mail clients use the one-click header instead. */
function UnsubscribeInner() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const unsubscribe = useMutation(() => unsubscribeFromProductUpdates(token), {
    fallback: "This unsubscribe link is not valid.",
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <AuthCard
        title="You are unsubscribed"
        subtitle="Vidit sends you no more emails about major releases. Turn them back on in Settings at any time."
      />
    );
  }

  return (
    <AuthCard
      title="Unsubscribe from release emails"
      subtitle="Stop the emails Vidit sends about each major release. Notification emails follow their own switches in Settings."
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
        {unsubscribe.loading ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
    </AuthCard>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
