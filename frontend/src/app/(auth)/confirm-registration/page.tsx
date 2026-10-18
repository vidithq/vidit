"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClasses } from "@/components/ui/Button";
import { TEXT_LINK } from "@/components/ui/styles";

type State = "confirming" | "success" | "failed";

/** Consumes the single-use token on mount; the backend sets session and CSRF cookies in the same response. */
function ConfirmInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("confirming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ranRef = useRef(false);
  const { refresh } = useAuth();

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (token.length < 10) {
      setState("failed");
      setErrorMsg("This confirmation link is missing a token.");
      return;
    }

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
      .catch((err) => {
        setState("failed");
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "This confirmation link is invalid or expired."
        );
      });
  }, [token, refresh]);

  const title = {
    confirming: "Confirming your account…",
    success: "Account confirmed",
    failed: "Link no longer valid",
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

      {state === "failed" && (
        <>
          <p className="text-xs text-neutral-400">
            {errorMsg ??
              "This confirmation link is invalid or expired. Start the registration over to get a fresh one."}
          </p>
          <p className="text-xs">
            <Link href="/register" className={TEXT_LINK}>
              Start over →
            </Link>
          </p>
        </>
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
