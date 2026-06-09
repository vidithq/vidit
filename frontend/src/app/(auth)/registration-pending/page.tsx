"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Mail } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AuthCard } from "@/components/auth/AuthCard";

type ResendState = "idle" | "sending" | "sent" | "failed";

/**
 * Landing page after `POST /auth/register`. The backend has accepted
 * the registration and queued a confirmation email; no `users` row
 * exists yet. We tell the user to check their inbox and offer a
 * resend button.
 *
 * Resend is rate-limited server-side (5/hour per IP). We don't try
 * to mirror that limit on the client — the worst case is that the
 * user gets a 429 we surface as a generic failure, which is fine.
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
          <Link href="/login" className="text-orange-400 hover:underline">
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
          <button
            type="button"
            onClick={handleResend}
            disabled={!email}
            className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-md text-xs font-medium text-neutral-200 transition-colors"
          >
            Resend confirmation link
          </button>
        )}
        {resend === "sending" && (
          <p className="text-xs text-neutral-500">Sending…</p>
        )}
        {resend === "sent" && (
          <p className="text-xs text-orange-300">
            Sent — check your inbox in a moment.
          </p>
        )}
        {resend === "failed" && (
          <button
            type="button"
            onClick={handleResend}
            className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 rounded-md text-xs text-red-300 transition-colors"
          >
            Try again
          </button>
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
