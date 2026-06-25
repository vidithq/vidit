"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@/hooks/useMutation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";


interface Props {
  onSuccess: () => void;
}

export default function LoginForm({ onSuccess }: Props) {
  const { login } = useAuth();
  const params = useSearchParams();
  // Set by /reset-password on success — surfaces a one-time confirmation that
  // the new password is live.
  const justReset = params.get("reset") === "ok";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submitLogin = useMutation(() => login(email, password), {
    fallback: "Login failed",
    onSuccess: () => onSuccess(),
  });
  const { error } = submitLogin;
  const submitting = submitLogin.loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitLogin.run();
  };

  return (
    <AuthCard title="Sign in to Vidit" subtitle="OSINT/GEOINT geolocation platform">
      <form onSubmit={handleSubmit} className="space-y-4">
        {justReset && !error && (
          <div className="bg-orange-500/15 border border-orange-500/30 text-orange-200 px-3 py-2 rounded-sm text-xs">
            Password reset — sign in with your new password.
          </div>
        )}
        {error && (
          <div className={FORM_ERROR_BANNER_COMPACT}>
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className={FORM_LABEL_COMPACT}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FORM_INPUT}
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
            className={FORM_INPUT}
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
    </AuthCard>
  );
}
