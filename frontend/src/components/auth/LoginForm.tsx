"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@/hooks/useMutation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { TEXT_LINK } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL_COMPACT,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";


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
          <div className={FORM_SUCCESS_BANNER}>
            Password reset, sign in with your new password.
          </div>
        )}
        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className={FORM_LABEL_COMPACT}>
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
              className={`text-[10px] ${TEXT_LINK}`}
            >
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button
          variant="primary"
          fullWidth
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-xs text-neutral-400">
        No account?{" "}
        <Link href="/register" className={TEXT_LINK}>
          Register with an invite code
        </Link>
      </p>

      <p className="text-center text-[11px] text-neutral-500">
        Didn&apos;t receive your confirmation email?{" "}
        <Link
          href="/resend-confirmation"
          className={TEXT_LINK}
        >
          Resend it
        </Link>
      </p>
    </AuthCard>
  );
}
