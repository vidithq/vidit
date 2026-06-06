"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER_COMPACT } from "@/components/ui/form-styles";


/**
 * Reset-password landing — opened from the email link.
 *
 * The token is taken straight from the query string. Backend treats every
 * failure mode (unknown / expired / already-consumed / wrong-purpose) as
 * the same opaque 400 to avoid leaking which step rejected; the UI mirrors
 * that — one "invalid or expired link" path for any error.
 */
function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenMissing = token.length < 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      router.push("/login?reset=ok");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Reset failed — request a new link.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (tokenMissing) {
    return (
      <div className="w-full max-w-sm space-y-6 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
        <h1 className="text-lg font-medium text-neutral-100">Link incomplete</h1>
        <p className="text-xs text-neutral-400">
          This URL doesn&apos;t carry a valid reset token. Open the link from
          the email we sent, or{" "}
          <Link
            href="/forgot-password"
            className="text-orange-400 hover:underline"
          >
            request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      <div>
        <h1 className="text-lg font-medium text-neutral-100">
          Set a new password
        </h1>
        <p className="text-neutral-400 text-xs mt-1">
          Pick something at least 8 characters long. The link is single-use, so
          finish here.
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
            htmlFor="password"
            className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1"
          >
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1"
          >
            Confirm
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
        >
          {submitting ? "Saving..." : "Set new password"}
        </button>
      </form>

      <p className="text-center text-xs text-neutral-400">
        <Link href="/login" className="text-orange-400 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
