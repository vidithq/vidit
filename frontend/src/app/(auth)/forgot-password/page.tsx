"use client";

import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { SingleEmailFlow } from "@/components/auth/SingleEmailFlow";

/**
 * Forgot-password landing.
 *
 * The backend deliberately responds 204 whether or not the email matches
 * a real account (anti-enumeration). The UI mirrors that contract: on
 * success we always show the same "if that address exists, we've sent a
 * reset link" message — never confirm or deny that the email was found.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email tied to your Vidit account. We'll send a link to set a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="text-orange-400 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <SingleEmailFlow
        endpoint="/auth/forgot-password"
        submitLabel="Send reset link"
        renderSent={(email, reset) => (
          <div className="space-y-4">
            <p className="text-sm font-medium text-neutral-100">
              Check your email
            </p>
            <p className="text-xs text-neutral-400">
              If <span className="text-neutral-300">{email}</span>{" "}
              is registered, we&apos;ve just sent a password-reset link to it.
              The link works once and expires in 15 minutes.
            </p>
            <p className="text-xs text-neutral-500">
              Didn&apos;t arrive? Check spam, or{" "}
              <button
                type="button"
                onClick={reset}
                className="text-orange-400 hover:underline"
              >
                try a different address
              </button>
              .
            </p>
          </div>
        )}
      />
    </AuthCard>
  );
}
