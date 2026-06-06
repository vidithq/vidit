"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER_COMPACT } from "@/components/ui/form-styles";


interface Props {
  onSuccess: () => void;
}

export default function LoginForm({ onSuccess }: Props) {
  const { login } = useAuth();
  const params = useSearchParams();
  // Set by /reset-password on success — surfaces a one-time toast
  // so the user knows the new password is live and can be used here.
  const justReset = params.get("reset") === "ok";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      <div>
        <h1 className="text-lg font-medium text-neutral-100">Sign in to Vidit</h1>
        <p className="text-neutral-400 text-xs mt-1">
          OSINT/GEOINT geolocation platform
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {justReset && !error && (
          <div className="bg-orange-500/15 border border-orange-500/30 text-orange-200 px-3 py-2 rounded text-xs">
            Password reset — sign in with your new password.
          </div>
        )}
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

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label
              htmlFor="password"
              className="block text-[10px] uppercase tracking-wider text-neutral-500"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-[10px] text-orange-400 hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="text-center text-xs text-neutral-400">
        No account?{" "}
        <Link href="/register" className="text-orange-400 hover:underline">
          Register with an invite code
        </Link>
      </p>

      <p className="text-center text-[11px] text-neutral-500">
        Didn&apos;t receive your confirmation email?{" "}
        <Link
          href="/resend-confirmation"
          className="text-orange-400 hover:underline"
        >
          Resend it
        </Link>
      </p>
    </div>
  );
}
