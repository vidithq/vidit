"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { useMutation } from "@/hooks/useMutation";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";

interface SingleEmailFlowProps {
  /** POST target; receives `{ email }` (trimmed). */
  endpoint: string;
  submitLabel: string;
  placeholder?: string;
  /** Body rendered once the backend accepts. Both endpoints are anti-
   *  enumeration (204 whether or not the address matched), so the copy must
   *  never confirm the address exists — phrase it "if X is registered…".
   *  `reset` returns to the empty idle form. */
  renderSent: (email: string, reset: () => void) => ReactNode;
}

/**
 * Single-email-input machine shared by /forgot-password and
 * /resend-confirmation: idle → sending → sent | failed. Failure shows the API
 * message above the input; success swaps the form for the `renderSent` copy.
 */
export function SingleEmailFlow({
  endpoint,
  submitLabel,
  placeholder,
  renderSent,
}: SingleEmailFlowProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = useMutation(
    () =>
      apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    {
      fallback: "Request failed",
      onSuccess: () => setSent(true),
    }
  );
  const sending = submit.loading;
  const errorMessage = submit.error;

  if (sent) {
    return (
      <>
        {renderSent(email.trim(), () => {
          setEmail("");
          setSent(false);
          submit.reset();
        })}
      </>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit.run();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className={FORM_ERROR_BANNER_COMPACT}>{errorMessage}</div>
      )}

      <div>
        <label htmlFor="email" className={FORM_LABEL_COMPACT}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FORM_INPUT}
          placeholder={placeholder}
        />
      </div>

      <button
        type="submit"
        disabled={sending}
        className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
      >
        {sending ? "Sending..." : submitLabel}
      </button>
    </form>
  );
}
