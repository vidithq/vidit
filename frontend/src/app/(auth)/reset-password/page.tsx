"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PASSWORD_MIN_LENGTH, validatePasswordChange } from "@/lib/auth";
import { useMutation } from "@/hooks/useMutation";
import { AuthCard } from "@/components/auth/AuthCard";
import { TEXT_LINK } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";


/**
 * Reset-password landing, opened from the email link; token comes from the
 * query string. Backend returns the same opaque 400 for every failure mode
 * (unknown / expired / consumed / wrong-purpose) to avoid leaking which
 * step rejected; the UI mirrors that with one "invalid link" path.
 */
function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const resetPassword = useMutation(
    () =>
      apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      }),
    {
      fallback: "Reset failed. Request a new link.",
      onSuccess: () => {
        router.push("/login?reset=ok");
      },
    }
  );
  const { error, setError } = resetPassword;
  const submitting = resetPassword.loading;

  const tokenMissing = token.length < 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validatePasswordChange(password, confirm, "Password");
    if (validationError) {
      setError(validationError);
      return;
    }

    await resetPassword.run();
  };

  if (tokenMissing) {
    return (
      <AuthCard title="Link incomplete">
        <p className="text-xs text-neutral-400">
          This URL doesn&apos;t carry a valid reset token. Open the link from
          the email we sent, or{" "}
          <Link
            href="/forgot-password"
            className={TEXT_LINK}
          >
            request a new one
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle={`Pick something at least ${PASSWORD_MIN_LENGTH} characters long. The link is single-use, so finish here.`}
      footer={
        <Link href="/login" className={TEXT_LINK}>
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="password" className={FORM_LABEL_COMPACT}>
            New password
          </label>
          <Input
            id="password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="confirm" className={FORM_LABEL_COMPACT}>
            Confirm
          </label>
          <Input
            id="confirm"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <Button
          variant="primary"
          fullWidth
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Saving..." : "Set new password"}
        </Button>
      </form>
    </AuthCard>
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
