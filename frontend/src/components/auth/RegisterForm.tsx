"use client";

import { useState } from "react";
import { useMutation } from "@/hooks/useMutation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { TEXT_LINK } from "@/components/ui/styles";
import { ApiError } from "@/lib/api";
import { PASSWORD_MAX_BYTES, validateNewPassword } from "@/lib/auth";
import { register } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FORM_LABEL_COMPACT } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { blankFields, useIncompleteForm } from "@/hooks/useIncompleteForm";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

interface Props {
  /** Called once the backend accepts the payload (202), with the email the confirmation link goes to. */
  onSuccess: (email: string) => void;
  initialInviteCode?: string;
}

export default function RegisterForm({
  onSuccess,
  initialInviteCode = "",
}: Props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const inviteCodeLocked = initialInviteCode.length > 0;
  const incomplete = useIncompleteForm<"invite_code" | "username" | "email" | "password">();
  const { invalidKeys } = incomplete;

  const submitRegister = useMutation(
    async () => {
      try {
        const result = await register({ username, email, password, invite_code: inviteCode });
        return result.email;
      } catch (err) {
        // Already registered but unconfirmed: recoverable, so route to the pending screen's Resend rather
        // than a dead-end error. Branch on the backend's stable `code` (`RegistrationError` in
        // `backend/app/services/registration.py`), not English prose. Resolving with the typed email
        // sends both paths through `onSuccess`.
        if (
          err instanceof ApiError &&
          err.code === "email_pending_confirmation"
        ) {
          return email;
        }
        throw err;
      }
    },
    {
      fallback: "Registration failed",
      onSuccess: (resolvedEmail) => onSuccess(resolvedEmail),
    }
  );
  const { error, setError } = submitRegister;
  const submitting = submitRegister.loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = blankFields([
      { key: "invite_code", label: "Invite code", value: inviteCode },
      { key: "username", label: "Username", value: username },
      { key: "email", label: "Email", value: email },
      { key: "password", label: "Password", value: password },
    ]);
    if (missing.length) {
      setError(null);
      incomplete.flagIncomplete(missing);
      return;
    }
    incomplete.clearIncomplete();
    const validationError = validateNewPassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }
    await submitRegister.run();
  };

  return (
    <AuthCard
      title="Join Vidit"
      subtitle="Registration requires an invite code. We'll send a confirmation link before creating your account."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={TEXT_LINK}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <IncompleteFormAnnouncer
          attempt={incomplete.validationAttempt}
          missing={incomplete.missingFields.map((m) => m.label)}
        />
        {error && (
          <ErrorNotice error={error} />
        )}

        <div className="space-y-1">
          <FieldLabel
            htmlFor="invite_code"
            label="Invite code"
            invalid={invalidKeys.has("invite_code")}
            className={FORM_LABEL_COMPACT}
          />
          <Input
            id="invite_code"
            invalid={invalidKeys.has("invite_code")}
            type="text"
            readOnly={inviteCodeLocked}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className={inviteCodeLocked ? "opacity-70 cursor-not-allowed" : ""}
            placeholder="Paste your invite code"
          />
          {inviteCodeLocked && (
            <p className="text-[10px] text-neutral-500">
              From your invite link
            </p>
          )}
        </div>

        <div className="space-y-1">
          <FieldLabel
            htmlFor="username"
            label="Username"
            invalid={invalidKeys.has("username")}
            className={FORM_LABEL_COMPACT}
          />
          <Input
            id="username"
            invalid={invalidKeys.has("username")}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <FieldLabel
            htmlFor="email"
            label="Email"
            invalid={invalidKeys.has("email")}
            className={FORM_LABEL_COMPACT}
          />
          <Input
            id="email"
            invalid={invalidKeys.has("email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <FieldLabel
            htmlFor="password"
            label="Password"
            invalid={invalidKeys.has("password")}
            className={FORM_LABEL_COMPACT}
          />
          <Input
            id="password"
            invalid={invalidKeys.has("password")}
            type="password"
            maxLength={PASSWORD_MAX_BYTES}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button
          action="continue"
          variant="primary"
          fullWidth
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Sending confirmation..." : "Continue"}
        </Button>
      </form>
    </AuthCard>
  );
}
