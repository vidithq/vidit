"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { readError, type ReadableError } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClasses } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { TEXT_LINK } from "@/components/ui/styles";

type State = "confirming" | "success" | "invalid" | "unanswered";

// Below this the token cannot be one the backend minted, so no request is spent on it.
const MIN_TOKEN_LENGTH = 10;

/** Consumes the single-use token on mount; the backend sets session and CSRF cookies in the same
 * response. A refused token reads as expired or invalid, whatever the refusal; no answer offers
 * Retry, since the token is still unspent. */
function ConfirmInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const tooShort = token.length < MIN_TOKEN_LENGTH;
  const [state, setState] = useState<State>(tooShort ? "invalid" : "confirming");
  const [fault, setFault] = useState<ReadableError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { refresh } = useAuth();

  // The token is single use: a second request for one attempt (a Strict Mode re-run) would find
  // it spent and report the link invalid.
  const ranFor = useRef(-1);

  useEffect(() => {
    if (tooShort || ranFor.current === attempt) return;
    ranFor.current = attempt;
    apiFetch("/auth/confirm-registration", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(async () => {
        try {
          await refresh();
        } catch {
          /* non-fatal: the next page load catches up */
        }
        setState("success");
      })
      .catch((err: unknown) => {
        const readable = readError(err);
        setFault(readable);
        setState(readable.title ? "unanswered" : "invalid");
      });
  }, [token, tooShort, refresh, attempt]);

  const title = {
    confirming: "Confirming your account…",
    success: "Account confirmed",
    invalid: "Link expired or invalid",
    unanswered: "Account not confirmed yet",
  }[state];

  return (
    <AuthCard title={title}>
      {state === "confirming" && (
        <p className="text-xs text-neutral-400">One moment.</p>
      )}

      {state === "success" && (
        <>
          <p className="text-xs text-neutral-400">
            Welcome to Vidit. Bring the geolocations you already posted on X
            onto the map, or start with a short tour of the site.
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/submit?import=1" className={buttonClasses("primary", { fullWidth: true })}>
              Import your X archive
            </Link>
            <Link href="/guide" className={buttonClasses("secondary", { fullWidth: true })}>
              Read Getting started
            </Link>
          </div>
        </>
      )}

      {state === "invalid" && (
        <>
          <p className="text-xs text-neutral-400">
            A confirmation link works once and expires after 24 hours.
          </p>
          <p className="text-xs">
            <Link href="/resend-confirmation" className={TEXT_LINK}>
              Get a new confirmation link
            </Link>
          </p>
        </>
      )}

      {state === "unanswered" && (
        <ErrorNotice
          error={fault}
          onRetry={() => {
            setState("confirming");
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </AuthCard>
  );
}

export default function ConfirmRegistrationPage() {
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <ConfirmInner />
    </Suspense>
  );
}
