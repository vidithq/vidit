"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { SingleEmailFlow } from "@/components/auth/SingleEmailFlow";

/**
 * Standalone "resend confirmation" surface for users who closed the
 * `/registration-pending` tab. Returns the same UX regardless of whether
 * the address matched a pending row, so it can't enumerate addresses with
 * live pending registrations. Linked from `/login`.
 */
export default function ResendConfirmationPage() {
  return (
    <AuthCard
      icon={Mail}
      title="Resend confirmation link"
      subtitle="If an account is pending confirmation for your email, we'll send a fresh link to your inbox."
      footer={
        <>
          Already confirmed?{" "}
          <Link href="/login" className="text-orange-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SingleEmailFlow
        endpoint="/auth/resend-confirmation"
        submitLabel="Send a fresh link"
        placeholder="the address you registered with"
        renderSent={(email, reset) => (
          <div className="space-y-4">
            <p className="text-xs text-neutral-300">
              Sent. Check your inbox at{" "}
              <span className="text-orange-300">{email}</span>. The link
              expires in 24 hours.
            </p>
            <p className="text-[11px] text-neutral-500">
              We deliberately don&apos;t tell you whether the address matched a
              pending registration — addresses without a live pending row
              silently receive nothing.
            </p>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] text-orange-400 hover:underline"
            >
              Send to a different address
            </button>
          </div>
        )}
      />
    </AuthCard>
  );
}
