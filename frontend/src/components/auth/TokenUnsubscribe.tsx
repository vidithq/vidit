"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { TEXT_LINK } from "@/components/ui/styles";
import { useMutation } from "@/hooks/useMutation";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

export interface TokenUnsubscribeCopy {
  title: string;
  subtitle: string;
  action: string;
  pending: string;
  doneTitle: string;
  doneSubtitle: string;
}

function TokenUnsubscribeInner({
  unsubscribe,
  copy,
}: {
  unsubscribe: (token: string) => Promise<unknown>;
  copy: (token: string) => TokenUnsubscribeCopy;
}) {
  const token = useSearchParams().get("token") ?? "";
  const text = copy(token);
  const [done, setDone] = useState(false);
  const run = useMutation(() => unsubscribe(token), {
    fallback: "This unsubscribe link is not valid.",
    onSuccess: () => setDone(true),
  });

  if (done) return <AuthCard title={text.doneTitle} subtitle={text.doneSubtitle} />;

  return (
    <AuthCard
      title={text.title}
      subtitle={text.subtitle}
      footer={
        <Link href="/settings" className={TEXT_LINK}>
          Open Settings
        </Link>
      }
    >
      {run.error && <ErrorNotice error={run.error} />}
      <Button
        variant="primary"
        fullWidth
        disabled={!token || run.loading}
        onClick={() => void run.run()}
      >
        {run.loading ? text.pending : text.action}
      </Button>
    </AuthCard>
  );
}

/**
 * The landing of an email's unsubscribe link, `?token=`. It works without a session: the signed
 * token names the account. A click confirms, so a mail scanner that opens the link turns nothing
 * off; mail clients use the one-click header instead.
 */
export function TokenUnsubscribe(props: {
  unsubscribe: (token: string) => Promise<unknown>;
  copy: (token: string) => TokenUnsubscribeCopy;
}) {
  return (
    <Suspense fallback={null}>
      <TokenUnsubscribeInner {...props} />
    </Suspense>
  );
}
