"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { useMutation } from "@/hooks/useMutation";
import { FORM_INVALID_LABEL, FORM_LABEL_COMPACT } from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { Input } from "@/components/ui/Input";
import { blankFields, useIncompleteForm } from "@/hooks/useIncompleteForm";
import { ErrorNotice, FieldError } from "@/components/ui/ErrorNotice";

interface SingleEmailFlowProps {
  /** POST target; receives `{ email }` (trimmed). */
  endpoint: string;
  submitLabel: string;
  placeholder?: string;
  /** Body rendered once the backend accepts. Both endpoints are anti-enumeration (204 whether or
   * not the address matched), so the copy must never confirm the address exists ("if X is
   * registered..."). `reset` returns to the empty idle form. */
  renderSent: (email: string, reset: () => void) => ReactNode;
}

/**
 * Single-email-input machine shared by /forgot-password and /resend-confirmation: idle, sending,
 * then sent or failed. Failure shows the API message above the input; success swaps the form for
 * `renderSent`.
 */
export function SingleEmailFlow({
  endpoint,
  submitLabel,
  placeholder,
  renderSent,
}: SingleEmailFlowProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const incomplete = useIncompleteForm<"email">();

  const submit = useMutation(
    () =>
      apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    {
      fallback: "Request failed",
      fields: ["email"],
      onSuccess: () => setSent(true),
    }
  );
  const sending = submit.loading;
  const errorMessage = submit.error;
  const emailRefused = submit.fieldErrors.email !== undefined;

  if (sent) {
    return (
      <>
        {renderSent(email.trim(), () => {
          setEmail("");
          setSent(false);
          submit.reset();
          incomplete.clearIncomplete();
        })}
      </>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = blankFields([{ key: "email", label: "Email", value: email }]);
    if (missing.length) {
      submit.reset();
      incomplete.flagIncomplete(missing);
      return;
    }
    incomplete.clearIncomplete();
    await submit.run();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <IncompleteFormAnnouncer
        attempt={incomplete.validationAttempt}
        missing={incomplete.missingFields.map((m) => m.label)}
      />
      <ErrorNotice error={errorMessage} />

      <div className="space-y-1">
        <label
          htmlFor="email"
          className={cn(
            incomplete.labelClass("email", FORM_LABEL_COMPACT),
            emailRefused && FORM_INVALID_LABEL,
          )}
        >
          Email
        </label>
        <Input
          id="email"
          invalid={incomplete.invalidKeys.has("email") || emailRefused}
          aria-describedby={emailRefused ? "email-error" : undefined}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={placeholder}
        />
        <FieldError id="email-error" alert>
          {submit.fieldErrors.email}
        </FieldError>
      </div>

      <Button
        variant="primary"
        fullWidth
        type="submit"
        disabled={sending}
      >
        {sending ? "Sending..." : submitLabel}
      </Button>
    </form>
  );
}
