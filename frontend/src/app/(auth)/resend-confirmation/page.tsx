"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import {
  FORM_INPUT,
  FORM_LABEL_COMPACT,
} from "@/components/ui/form-styles";



type State = "idle" | "sending" | "sent" | "failed";

/**
 * Standalone "resend confirmation" surface for users who closed the
 * tab on `/registration-pending` and can't easily get back. Mirrors
 * the `/forgot-password` shape: a single email input, always returns
 * the same UX regardless of whether the address matched a pending
 * row, so the page cannot be used to enumerate addresses with live
 * pending registrations.
 *
 * Discoverability: linked from `/login` as "Didn't receive your
 * confirmation email?" — the standard pattern for hard-pre-creation
 * verification flows (Mailchimp, Substack, Linear waitlist, AWS).
 */
export default function ResendConfirmationPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      await apiFetch("/auth/resend-confirmation", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="w-full max-w-sm space-y-5 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      <div className="flex items-start gap-3">
        <Mail size={20} className="text-orange-400 shrink-0 mt-1" />
        <div>
          <h1 className="text-lg font-medium text-neutral-100">
            Resend confirmation link
          </h1>
          <p className="text-neutral-400 text-xs mt-1">
            If an account is pending confirmation for your email, we&apos;ll
            send a fresh link to your inbox.
          </p>
        </div>
      </div>

      {state === "sent" ? (
        <>
          <p className="text-xs text-neutral-300">
            Sent. Check your inbox at{" "}
            <span className="text-orange-300">{email.trim()}</span>. The link
            expires in 24 hours.
          </p>
          <p className="text-[11px] text-neutral-500">
            We deliberately don&apos;t tell you whether the address matched a
            pending registration — addresses without a live pending row
            silently receive nothing.
          </p>
          <button
            type="button"
            onClick={() => {
              setEmail("");
              setState("idle");
            }}
            className="text-[11px] text-orange-400 hover:underline"
          >
            Send to a different address
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="the address you registered with"
            />
          </div>

          <button
            type="submit"
            disabled={state === "sending"}
            className={`w-full py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
          >
            {state === "sending" ? "Sending..." : "Send a fresh link"}
          </button>

          {state === "failed" && (
            <p className="text-xs text-red-300">
              Something went wrong. Try again in a moment.
            </p>
          )}
        </form>
      )}

      <p className="text-center text-xs text-neutral-400">
        Already confirmed?{" "}
        <Link href="/login" className="text-orange-400 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
