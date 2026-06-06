"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER_COMPACT } from "@/components/ui/form-styles";


/**
 * Forgot-password landing.
 *
 * The backend deliberately responds 204 whether or not the email matches
 * a real account (anti-enumeration). The UI mirrors that contract: on
 * success we always show the same "if that address exists, we've sent a
 * reset link" message — never confirm or deny that the email was found.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-6 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
        <div>
          <h1 className="text-lg font-medium text-neutral-100">
            Check your email
          </h1>
          <p className="text-neutral-400 text-xs mt-1">
            If <span className="text-neutral-300">{email}</span> is registered,
            we&apos;ve just sent a password-reset link to it. The link works
            once and expires in 15 minutes.
          </p>
        </div>
        <p className="text-xs text-neutral-500">
          Didn&apos;t arrive? Check spam, or{" "}
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="text-orange-400 hover:underline"
          >
            try a different address
          </button>
          .
        </p>
        <p className="text-center text-xs text-neutral-400">
          <Link href="/login" className="text-orange-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      <div>
        <h1 className="text-lg font-medium text-neutral-100">
          Reset your password
        </h1>
        <p className="text-neutral-400 text-xs mt-1">
          Enter the email tied to your Vidit account. We&apos;ll send a link to
          set a new password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className={FORM_ERROR_BANNER_COMPACT}>
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
        >
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p className="text-center text-xs text-neutral-400">
        Remembered it?{" "}
        <Link href="/login" className="text-orange-400 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
