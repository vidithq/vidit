"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Mail } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { TEXT_LINK } from "@/components/ui/styles";

type ResendState = "idle" | "sending" | "sent" | "failed";

/**
 * Landing after `POST /auth/register`: registration accepted and a
 * confirmation email queued, but no `users` row exists yet.
 *
 * Resend is rate-limited server-side (5/hour per IP); not mirrored on the
 * client — worst case is a 429 surfaced as a generic failure.
 */
function PendingInner() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [resend, setResend] = useState<ResendState>("idle");

  const handleResend = async () => {
    if (!email) return;
    setResend("sending");
    try {
      await apiFetch("/auth/resend-confirmation", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResend("sent");
    } catch {
      setResend("failed");
    }
  };

  return (
    <AuthCard
      icon={Mail}
      title="Check your inbox"
      subtitle={
        <>
          We sent a confirmation link to{" "}
          <span className="text-neutral-200">{email || "your address"}</span>.
          The link is valid for the next 24 hours. Your account will be created
          when you click it.
        </>
      }
      footer={
        <>
          Already confirmed?{" "}
          <Link href="/login" className={TEXT_LINK}>
            Sign in
          </Link>
        </>
      }
    >
      <div className="border-t border-neutral-800 pt-4 space-y-2">
        <p className="text-xs text-neutral-500">
          Didn&apos;t get the email? Check spam, then resend.
        </p>
        {resend === "idle" && (
          <Button
            variant="secondary"
            fullWidth
            onClick={handleResend}
            disabled={!email}
          >
            Resend confirmation link
          </Button>
        )}
        {resend === "sending" && (
          <p className="text-xs text-neutral-500">Sending…</p>
        )}
        {resend === "sent" && (
          <p className="text-xs text-orange-300">
            Sent. Check your inbox in a moment.
          </p>
        )}
        {resend === "failed" && (
          <Button variant="secondary" fullWidth onClick={handleResend}>
            Try again
          </Button>
        )}
      </div>
    </AuthCard>
  );
}

export default function RegistrationPendingPage() {
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <PendingInner />
    </Suspense>
  );
}
