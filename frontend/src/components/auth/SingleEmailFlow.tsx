"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER_COMPACT,
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";

type FlowState = "idle" | "sending" | "sent" | "failed";

interface SingleEmailFlowProps {
  /** POST target; receives `{ email }` (trimmed). */
  endpoint: string;
  submitLabel: string;
  placeholder?: string;
  /** Body to render once the backend accepts. Both consumers sit behind
   *  anti-enumeration endpoints (204 whether or not the address matched),
   *  so the copy must never confirm the address exists — phrase it as
   *  "if X is registered…". `reset` returns to the empty idle form. */
  renderSent: (email: string, reset: () => void) => ReactNode;
}

/**
 * The single-email-input machine shared by /forgot-password and
 * /resend-confirmation: idle → sending → sent | failed, failure shows
 * the API message above the input, success swaps the form for the
 * page's `renderSent` copy.
 */
export function SingleEmailFlow({
  endpoint,
  submitLabel,
  placeholder,
  renderSent,
}: SingleEmailFlowProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FlowState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (state === "sent") {
    return (
      <>
        {renderSent(email.trim(), () => {
          setEmail("");
          setState("idle");
        })}
      </>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setState("sending");
    try {
      await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setState("sent");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Request failed");
      setState("failed");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {state === "failed" && errorMessage && (
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
        disabled={state === "sending"}
        className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
      >
        {state === "sending" ? "Sending..." : submitLabel}
      </button>
    </form>
  );
}
