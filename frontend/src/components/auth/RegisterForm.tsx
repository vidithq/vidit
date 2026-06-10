"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { ApiError } from "@/lib/api";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";



interface Props {
  /** Called once the backend accepts the payload (202). Receives the
   * email the confirmation link will be sent to so the next screen can
   * display it back to the user. */
  onSuccess: (email: string) => void;
  initialInviteCode?: string;
}

export default function RegisterForm({
  onSuccess,
  initialInviteCode = "",
}: Props) {
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const inviteCodeLocked = initialInviteCode.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await register(username, email, password, inviteCode);
      onSuccess(result.email);
    } catch (err) {
      // Already registered but unconfirmed (closed the tab / lost the email):
      // recoverable, so route to the pending screen's Resend rather than a
      // dead-end error. Branch on the backend's stable ``code`` (see
      // ``RegistrationError`` in ``backend/app/services/registration.py``),
      // not English prose.
      if (err instanceof ApiError && err.code === "email_pending_confirmation") {
        onSuccess(email);
        return;
      }
      const message = err instanceof Error ? err.message : "Registration failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Join Vidit"
      subtitle="Registration requires an invite code. We'll send a confirmation link before creating your account."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-orange-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className={FORM_ERROR_BANNER_COMPACT}>
            {error}
          </div>
        )}

        <div>
          <label htmlFor="invite_code" className={FORM_LABEL_COMPACT}>
            Invite code
          </label>
          <input
            id="invite_code"
            type="text"
            required
            readOnly={inviteCodeLocked}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className={`${FORM_INPUT}${
              inviteCodeLocked ? " opacity-70 cursor-not-allowed" : ""
            }`}
            placeholder="Paste your invite code"
          />
          {inviteCodeLocked && (
            <p className="text-[10px] text-neutral-500 mt-1">
              From your invite link
            </p>
          )}
        </div>

        <div>
          <label htmlFor="username" className={FORM_LABEL_COMPACT}>
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={FORM_INPUT}
          />
        </div>

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
          <label htmlFor="password" className={FORM_LABEL_COMPACT}>
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
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
          {submitting ? "Sending confirmation..." : "Continue"}
        </button>
      </form>
    </AuthCard>
  );
}
